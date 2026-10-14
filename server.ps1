$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:DataRoot = Join-Path $script:Root '.hearth-data'
$script:FileRoot = Join-Path $script:DataRoot 'files'
$script:DatabasePath = Join-Path $script:DataRoot 'database.json'
$script:Port = 8787

New-Item -ItemType Directory -Force -Path $script:FileRoot | Out-Null
if (-not (Test-Path $script:DatabasePath)) {
    $initial = [ordered]@{
        users = @()
        sessions = @()
        appointments = @()
        volunteerRequests = @()
        availability = @()
        files = @()
        dietPlans = @()
        medications = @()
    }
    [System.IO.File]::WriteAllText($script:DatabasePath, ($initial | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
}

function Read-Database {
    $database = [System.IO.File]::ReadAllText($script:DatabasePath) | ConvertFrom-Json
    if ($database.PSObject.Properties.Name -notcontains 'medications') {
        $database | Add-Member -NotePropertyName medications -NotePropertyValue @()
    }
    return $database
}

function Write-Database($Database) {
    $json = $Database | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText($script:DatabasePath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Send-Json($Context, $Value, [int]$StatusCode = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 30 -Compress))
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

function Send-Error($Context, [int]$StatusCode, [string]$Message) {
    Send-Json $Context @{ error = $Message } $StatusCode
}

function Read-Body($Context) {
    if ($Context.Request.ContentLength64 -gt 14000000) { throw 'Request is too large.' }
    $reader = New-Object System.IO.StreamReader($Context.Request.InputStream, $Context.Request.ContentEncoding)
    $text = $reader.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text | ConvertFrom-Json
}

function New-RandomToken {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $random.GetBytes($bytes)
    $random.Dispose()
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-TokenHash([string]$Token) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToBase64String($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Token)))
    } finally { $sha.Dispose() }
}

function Get-PasswordHash([string]$Password, [string]$Salt) {
    $saltBytes = [Convert]::FromBase64String($Salt)
    $derive = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Password, $saltBytes, 150000)
    try { return [Convert]::ToBase64String($derive.GetBytes(32)) } finally { $derive.Dispose() }
}

function New-Session($Context, $Database, $User) {
    $token = New-RandomToken
    $Database.sessions = @($Database.sessions) + @([pscustomobject]@{
        tokenHash = Get-TokenHash $token
        userId = $User.id
        expiresAt = [DateTime]::UtcNow.AddHours(8).ToString('o')
    })
    Write-Database $Database
    $Context.Response.AppendHeader('Set-Cookie', "hearth_session=$token; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800")
}

function Get-SessionUser($Context, $Database) {
    $cookie = $Context.Request.Cookies['hearth_session']
    if ($null -eq $cookie -or [string]::IsNullOrWhiteSpace($cookie.Value)) { return $null }
    $hash = Get-TokenHash $cookie.Value
    $session = @($Database.sessions | Where-Object { $_.tokenHash -eq $hash } | Select-Object -First 1)
    if ($session.Count -eq 0) { return $null }
    if ([DateTime]::Parse($session[0].expiresAt).ToUniversalTime() -lt [DateTime]::UtcNow) { return $null }
    return @($Database.users | Where-Object { $_.id -eq $session[0].userId } | Select-Object -First 1)[0]
}

function Public-User($User) {
    return [pscustomobject]@{ id = $User.id; name = $User.name; email = $User.email; role = $User.role }
}

function Require-Role($Context, $User, [string[]]$Roles) {
    if ($null -eq $User) { Send-Error $Context 401 'Sign in is required.'; return $false }
    if ($Roles -notcontains $User.role) { Send-Error $Context 403 'This action is not available for your account role.'; return $false }
    return $true
}

function Send-StaticFile($Context, [string]$Path) {
    $relative = $Path.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    if (@('index.html', 'api.js', 'backend-ui.js') -notcontains $relative) {
        Send-Error $Context 404 'Not found.'
        return
    }
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $script:Root $relative))
    if (-not $fullPath.StartsWith($script:Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $fullPath -PathType Leaf)) {
        Send-Error $Context 404 'Not found.'
        return
    }
    $contentType = switch ([System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.js' { 'text/javascript; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        default { 'application/octet-stream' }
    }
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $Context.Response.ContentType = $contentType
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Context.Response.Headers['X-Frame-Options'] = 'DENY'
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

function Apply-CorsHeaders($Context) {
    $origin = [string]$Context.Request.Headers['Origin']
    if ([string]::IsNullOrWhiteSpace($origin)) { return }
    $Context.Response.Headers['Access-Control-Allow-Origin'] = $origin
    $Context.Response.Headers['Access-Control-Allow-Credentials'] = 'true'
    $Context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    $Context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    $Context.Response.Headers['Vary'] = 'Origin'
}

function Handle-Request($Context) {
    $request = $Context.Request
    $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath)
    $method = $request.HttpMethod.ToUpperInvariant()

    Apply-CorsHeaders $Context

    if ($method -eq 'OPTIONS') {
        $Context.Response.StatusCode = 200
        $Context.Response.Close()
        return
    }

    if ($path -eq '/api/health' -and $method -eq 'GET') {
        Send-Json $Context @{ status = 'ok'; mode = 'local-demo'; persistentStore = 'json-files'; host = '127.0.0.1' }
        return
    }

    if ($path -eq '/api/register' -and $method -eq 'POST') {
        $body = Read-Body $Context
        $name = ([string]$body.name).Trim()
        $email = ([string]$body.email).Trim().ToLowerInvariant()
        $password = [string]$body.password
        $role = [string]$body.role
        if ($name.Length -lt 2 -or $name.Length -gt 100 -or $email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $password.Length -lt 10 -or $password.Length -gt 200) {
            Send-Error $Context 400 'Enter a name, valid email, and password with at least 10 characters.'
            return
        }
        if (@('patient', 'volunteer', 'doctor', 'unit') -notcontains $role) { Send-Error $Context 400 'Choose a valid account role.'; return }
        $db = Read-Database
        if (@($db.users | Where-Object { $_.email -eq $email }).Count -gt 0) { Send-Error $Context 409 'An account with that email already exists.'; return }
        $saltBytes = New-Object byte[] 16
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($saltBytes)
        $rng.Dispose()
        $salt = [Convert]::ToBase64String($saltBytes)
        $user = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); name = $name; email = $email; role = $role; salt = $salt; passwordHash = Get-PasswordHash $password $salt; createdAt = [DateTime]::UtcNow.ToString('o') }
        $db.users = @($db.users) + @($user)
        Write-Database $db
        New-Session $Context $db $user
        Send-Json $Context @{ user = Public-User $user } 201
        return
    }

    if ($path -eq '/api/login' -and $method -eq 'POST') {
        $body = Read-Body $Context
        $email = ([string]$body.email).Trim().ToLowerInvariant()
        $password = [string]$body.password
        $db = Read-Database
        $user = @($db.users | Where-Object { $_.email -eq $email } | Select-Object -First 1)
        if ($user.Count -eq 0 -or (Get-PasswordHash $password $user[0].salt) -ne $user[0].passwordHash) { Send-Error $Context 401 'Email or password was not recognized.'; return }
        New-Session $Context $db $user[0]
        Send-Json $Context @{ user = Public-User $user[0] }
        return
    }

    $db = Read-Database
    $user = Get-SessionUser $Context $db

    if ($path -eq '/api/me' -and $method -eq 'GET') {
        if ($null -eq $user) { Send-Error $Context 401 'Not signed in.'; return }
        Send-Json $Context @{ user = Public-User $user }
        return
    }

    if ($path -eq '/api/logout' -and $method -eq 'POST') {
        $cookie = $request.Cookies['hearth_session']
        if ($null -ne $cookie) {
            $tokenHash = Get-TokenHash $cookie.Value
            $db.sessions = @($db.sessions | Where-Object { $_.tokenHash -ne $tokenHash })
            Write-Database $db
        }
        $Context.Response.AppendHeader('Set-Cookie', 'hearth_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
        Send-Json $Context @{ ok = $true }
        return
    }

    if ($path -eq '/api/dashboard' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'volunteer', 'doctor', 'unit'))) { return }
        $appointments = if ($user.role -eq 'doctor' -or $user.role -eq 'unit') { @($db.appointments) } else { @($db.appointments | Where-Object { $_.userId -eq $user.id }) }
        $files = if ($user.role -eq 'doctor' -or $user.role -eq 'unit') { @($db.files) } else { @($db.files | Where-Object { $_.userId -eq $user.id }) }
        $requests = if ($user.role -eq 'patient') { @($db.volunteerRequests | Where-Object { $_.userId -eq $user.id }) } else { @($db.volunteerRequests | Where-Object { $_.status -eq 'open' -or $_.acceptedBy -eq $user.id }) }
        $medications = if ($user.role -eq 'patient') { @($db.medications | Where-Object { $_.patientId -eq $user.id }) } else { @($db.medications) }
        Send-Json $Context @{ user = Public-User $user; appointments = $appointments; files = $files; volunteerRequests = $requests; availability = @($db.availability); dietPlan = @($db.dietPlans | Where-Object { $_.userId -eq $user.id } | Select-Object -First 1); medications = $medications }
        return
    }

    if ($path -eq '/api/patients' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('doctor', 'unit'))) { return }
        Send-Json $Context @{ items = @($db.users | Where-Object { $_.role -eq 'patient' } | ForEach-Object { Public-User $_ }) }
        return
    }

    if ($path -eq '/api/medications' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        $items = if ($user.role -eq 'patient') { @($db.medications | Where-Object { $_.patientId -eq $user.id }) } else { @($db.medications) }
        Send-Json $Context @{ items = $items }
        return
    }

    if ($path -match '^/api/patients/([a-f0-9]+)/medications$' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('doctor', 'unit'))) { return }
        $patientId = $Matches[1]
        $patient = @($db.users | Where-Object { $_.id -eq $patientId -and $_.role -eq 'patient' } | Select-Object -First 1)
        if ($patient.Count -eq 0) { Send-Error $Context 404 'Patient account not found.'; return }
        $body = Read-Body $Context
        $name = ([string]$body.name).Trim()
        if ($name.Length -lt 2 -or $name.Length -gt 100) { Send-Error $Context 400 'Enter a medication name.'; return }
        $medication = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); patientId = $patientId; name = $name; dose = ([string]$body.dose).Substring(0, [Math]::Min(([string]$body.dose).Length, 100)); schedule = ([string]$body.schedule).Substring(0, [Math]::Min(([string]$body.schedule).Length, 100)); foodInstruction = ([string]$body.foodInstruction).Substring(0, [Math]::Min(([string]$body.foodInstruction).Length, 200)); prescribedBy = $user.id; createdAt = [DateTime]::UtcNow.ToString('o') }
        $db.medications = @($db.medications) + @($medication)
        Write-Database $db
        Send-Json $Context @{ item = $medication } 201
        return
    }

    if ($path -eq '/api/appointments' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        $items = if ($user.role -eq 'patient') { @($db.appointments | Where-Object { $_.userId -eq $user.id }) } else { @($db.appointments) }
        Send-Json $Context @{ items = $items }
        return
    }

    if ($path -eq '/api/appointments' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('patient'))) { return }
        $body = Read-Body $Context
        $appointment = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); userId = $user.id; patientName = $user.name; type = ([string]$body.type).Substring(0, [Math]::Min(([string]$body.type).Length, 100)); preferredDate = [string]$body.preferredDate; preferredTime = [string]$body.preferredTime; note = ([string]$body.note).Substring(0, [Math]::Min(([string]$body.note).Length, 1000)); status = 'pending'; createdAt = [DateTime]::UtcNow.ToString('o') }
        $db.appointments = @($db.appointments) + @($appointment)
        Write-Database $db
        Send-Json $Context @{ item = $appointment } 201
        return
    }

    if ($path -match '^/api/appointments/([a-f0-9]+)/([a-z]+)$' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('doctor'))) { return }
        $appointmentId = $Matches[1]
        $decision = $Matches[2]
        if (@('accept', 'decline') -notcontains $decision) { Send-Error $Context 404 'Not found.'; return }
        $appointment = @($db.appointments | Where-Object { $_.id -eq $appointmentId } | Select-Object -First 1)
        if ($appointment.Count -eq 0) { Send-Error $Context 404 'Appointment not found.'; return }
        $appointment[0] | Add-Member -NotePropertyName reviewedBy -NotePropertyValue $null -Force
        $appointment[0].status = if ($decision -eq 'accept') { 'accepted' } else { 'declined' }
        $appointment[0].reviewedBy = $user.id
        Write-Database $db
        Send-Json $Context @{ item = $appointment[0] }
        return
    }

    if ($path -eq '/api/availability' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        Send-Json $Context @{ items = @($db.availability) }
        return
    }

    if ($path -eq '/api/availability' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('doctor'))) { return }
        $body = Read-Body $Context
        $entry = @($db.availability | Where-Object { $_.doctorId -eq $user.id } | Select-Object -First 1)
        if ($entry.Count -eq 0) {
            $entry = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); doctorId = $user.id; doctorName = $user.name; available = [bool]$body.available; schedule = [string]$body.schedule; updatedAt = [DateTime]::UtcNow.ToString('o') }
            $db.availability = @($db.availability) + @($entry)
        } else {
            $entry[0].available = [bool]$body.available
            $entry[0].schedule = [string]$body.schedule
            $entry[0].updatedAt = [DateTime]::UtcNow.ToString('o')
            $entry = $entry[0]
        }
        Write-Database $db
        Send-Json $Context @{ item = $entry }
        return
    }

    if ($path -eq '/api/volunteer-requests' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'volunteer', 'doctor', 'unit'))) { return }
        $items = if ($user.role -eq 'patient') { @($db.volunteerRequests | Where-Object { $_.userId -eq $user.id }) } else { @($db.volunteerRequests | Where-Object { $_.status -eq 'open' -or $_.acceptedBy -eq $user.id }) }
        Send-Json $Context @{ items = $items }
        return
    }

    if ($path -eq '/api/volunteer-requests' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('patient'))) { return }
        $body = Read-Body $Context
        $requestItem = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); userId = $user.id; patientName = $user.name; support = ([string]$body.support).Substring(0, [Math]::Min(([string]$body.support).Length, 100)); details = ([string]$body.details).Substring(0, [Math]::Min(([string]$body.details).Length, 1000)); area = ([string]$body.area).Substring(0, [Math]::Min(([string]$body.area).Length, 100)); status = 'open'; acceptedBy = $null; createdAt = [DateTime]::UtcNow.ToString('o') }
        $db.volunteerRequests = @($db.volunteerRequests) + @($requestItem)
        Write-Database $db
        Send-Json $Context @{ item = $requestItem } 201
        return
    }

    if ($path -match '^/api/volunteer-requests/([a-f0-9]+)/accept$' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('volunteer'))) { return }
        $requestItem = @($db.volunteerRequests | Where-Object { $_.id -eq $Matches[1] } | Select-Object -First 1)
        if ($requestItem.Count -eq 0) { Send-Error $Context 404 'Request not found.'; return }
        if ($requestItem[0].status -ne 'open') { Send-Error $Context 409 'This request has already been matched.'; return }
        $requestItem[0] | Add-Member -NotePropertyName volunteerName -NotePropertyValue $null -Force
        $requestItem[0] | Add-Member -NotePropertyName acceptedAt -NotePropertyValue $null -Force
        $requestItem[0].status = 'accepted'
        $requestItem[0].acceptedBy = $user.id
        $requestItem[0].volunteerName = $user.name
        $requestItem[0].acceptedAt = [DateTime]::UtcNow.ToString('o')
        Write-Database $db
        Send-Json $Context @{ item = $requestItem[0] }
        return
    }

    if ($path -eq '/api/diet-plan' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        $plan = @($db.dietPlans | Where-Object { $_.userId -eq $user.id } | Select-Object -First 1)
        Send-Json $Context @{ item = if ($plan.Count) { $plan[0] } else { $null } }
        return
    }

    if ($path -eq '/api/diet-plan' -and $method -eq 'PUT') {
        if (-not (Require-Role $Context $user @('patient'))) { return }
        $body = Read-Body $Context
        $plan = @($db.dietPlans | Where-Object { $_.userId -eq $user.id } | Select-Object -First 1)
        if ($plan.Count -eq 0) {
            $plan = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); userId = $user.id; note = ([string]$body.note).Substring(0, [Math]::Min(([string]$body.note).Length, 1000)); reminder = [string]$body.reminder; updatedAt = [DateTime]::UtcNow.ToString('o') }
            $db.dietPlans = @($db.dietPlans) + @($plan)
        } else {
            $plan[0].note = ([string]$body.note).Substring(0, [Math]::Min(([string]$body.note).Length, 1000))
            $plan[0].reminder = [string]$body.reminder
            $plan[0].updatedAt = [DateTime]::UtcNow.ToString('o')
            $plan = $plan[0]
        }
        Write-Database $db
        Send-Json $Context @{ item = $plan }
        return
    }

    if ($path -eq '/api/files' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        $items = if ($user.role -eq 'patient') { @($db.files | Where-Object { $_.userId -eq $user.id }) } else { @($db.files) }
        Send-Json $Context @{ items = $items }
        return
    }

    if ($path -eq '/api/files' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('patient', 'doctor'))) { return }
        $body = Read-Body $Context
        $name = [System.IO.Path]::GetFileName(([string]$body.name).Trim())
        $extension = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($name) -or @('.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx') -notcontains $extension) { Send-Error $Context 400 'Choose a supported document file.'; return }
        try { $content = [Convert]::FromBase64String([string]$body.contentBase64) } catch { Send-Error $Context 400 'The uploaded file could not be decoded.'; return }
        if ($content.Length -gt 10000000) { Send-Error $Context 413 'Files must be smaller than 10 MB.'; return }
        $ownerId = $user.id
        if ($user.role -eq 'doctor' -and -not [string]::IsNullOrWhiteSpace([string]$body.patientId)) {
            $patient = @($db.users | Where-Object { $_.id -eq [string]$body.patientId -and $_.role -eq 'patient' } | Select-Object -First 1)
            if ($patient.Count -eq 0) { Send-Error $Context 404 'Patient account not found.'; return }
            $ownerId = $patient[0].id
        }
        $id = [Guid]::NewGuid().ToString('N')
        [System.IO.File]::WriteAllBytes((Join-Path $script:FileRoot ($id + $extension)), $content)
        $file = [pscustomobject]@{ id = $id; userId = $ownerId; uploadedBy = $user.id; name = $name; category = [string]$body.category; extension = $extension; bytes = $content.Length; createdAt = [DateTime]::UtcNow.ToString('o') }
        $db.files = @($db.files) + @($file)
        Write-Database $db
        Send-Json $Context @{ item = $file } 201
        return
    }

    if ($path -match '^/api/files/([a-f0-9]+)$' -and $method -eq 'GET') {
        if (-not (Require-Role $Context $user @('patient', 'doctor', 'unit'))) { return }
        $file = @($db.files | Where-Object { $_.id -eq $Matches[1] } | Select-Object -First 1)
        if ($file.Count -eq 0 -or ($user.role -eq 'patient' -and $file[0].userId -ne $user.id)) { Send-Error $Context 404 'File not found.'; return }
        $asset = Join-Path $script:FileRoot ($file[0].id + $file[0].extension)
        if (-not (Test-Path $asset)) { Send-Error $Context 404 'File contents not found.'; return }
        $bytes = [System.IO.File]::ReadAllBytes($asset)
        $Context.Response.ContentType = 'application/octet-stream'
        $Context.Response.Headers['Content-Disposition'] = "attachment; filename=`"$($file[0].name.Replace('`"', ''))`""
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }

    if ($path -eq '/api/assistant' -and $method -eq 'POST') {
        if (-not (Require-Role $Context $user @('patient', 'volunteer', 'doctor', 'unit'))) { return }
        $body = Read-Body $Context
        $question = ([string]$body.question).Trim()
        if ($question.Length -eq 0 -or $question.Length -gt 1000) { Send-Error $Context 400 'Enter a question under 1000 characters.'; return }
        $answer = 'I can help you find information in this account. For clinical decisions, contact your care team.'
        if ($user.role -eq 'patient') {
            if ($question -match '(?i)med|dose|noon|food') {
                $medications = @($db.medications | Where-Object { $_.patientId -eq $user.id })
                if ($medications.Count -eq 0) { $answer = 'I do not have a clinician-approved medication schedule loaded for this account yet. Check your care plan or contact your clinician before taking or changing medication.' }
                else { $answer = ($medications | ForEach-Object { "$($_.name) $($_.dose) at $($_.schedule); $($_.foodInstruction)" }) -join '; '; $answer = "Your care team entered: $answer. Follow the clinician-provided instructions and contact them if anything is unclear." }
            }
            elseif ($question -match '(?i)appointment|doctor|visit') { $items = @($db.appointments | Where-Object { $_.userId -eq $user.id }); $answer = "There are $($items.Count) appointments saved for your account. Open Appointments to review their status." }
            elseif ($question -match '(?i)volunteer|help|near') { $items = @($db.volunteerRequests | Where-Object { $_.userId -eq $user.id }); $answer = "You have $($items.Count) volunteer request(s) on file. Open Volunteer help to review them." }
            elseif ($question -match '(?i)file|report') { $items = @($db.files | Where-Object { $_.userId -eq $user.id }); $answer = "There are $($items.Count) care file(s) saved for your account." }
        } elseif ($user.role -eq 'volunteer') {
            $items = @($db.volunteerRequests | Where-Object { $_.status -eq 'open' }); $answer = "There are $($items.Count) open volunteer request(s). Patient details should only be shared after an authorized match."
        } elseif ($user.role -eq 'doctor') {
            $items = @($db.appointments | Where-Object { $_.status -eq 'pending' }); $answer = "There are $($items.Count) appointment request(s) awaiting review in this local workspace."
        } else {
            $patients = @($db.users | Where-Object { $_.role -eq 'patient' }); $requests = @($db.volunteerRequests | Where-Object { $_.status -eq 'open' }); $answer = "This workspace has $($patients.Count) registered patient account(s) and $($requests.Count) open volunteer request(s)."
        }
        $assistantMode = 'local-context'
        if ($env:HEARTH_ALLOW_EXTERNAL_AI -eq '1' -and -not [string]::IsNullOrWhiteSpace($env:HEARTH_AI_ENDPOINT) -and -not [string]::IsNullOrWhiteSpace($env:HEARTH_AI_API_KEY)) {
            $records = switch ($user.role) {
                'patient' { @{ medications = @($db.medications | Where-Object { $_.patientId -eq $user.id }); appointments = @($db.appointments | Where-Object { $_.userId -eq $user.id }); dietPlan = @($db.dietPlans | Where-Object { $_.userId -eq $user.id }); files = @($db.files | Where-Object { $_.userId -eq $user.id } | Select-Object name, category, createdAt) } }
                'volunteer' { @{ openRequests = @($db.volunteerRequests | Where-Object { $_.status -eq 'open' } | Select-Object support, area, details, status) } }
                'doctor' { @{ appointments = @($db.appointments | Select-Object patientName, type, preferredDate, preferredTime, status); patients = @($db.users | Where-Object { $_.role -eq 'patient' } | Select-Object name) } }
                default { @{ patientCount = @($db.users | Where-Object { $_.role -eq 'patient' }).Count; openVolunteerRequests = @($db.volunteerRequests | Where-Object { $_.status -eq 'open' }).Count } }
            }
            $prompt = [ordered]@{
                model = if ($env:HEARTH_AI_MODEL) { $env:HEARTH_AI_MODEL } else { 'gpt-4o-mini' }
                temperature = 0.2
                max_tokens = 350
                messages = @(
                    @{ role = 'system'; content = 'You are a care-coordination assistant. Answer briefly using only the supplied account records. Do not diagnose, prescribe, or recommend changing medication. If the records do not answer a question, say so and direct the user to their care team. For emergencies, direct them to local emergency services.' },
                    @{ role = 'user'; content = "Account role: $($user.role)`nQuestion: $question`nAuthorized account records: $($records | ConvertTo-Json -Depth 10 -Compress)" }
                )
            }
            try {
                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
                $aiResponse = Invoke-RestMethod -Uri $env:HEARTH_AI_ENDPOINT -Method Post -Headers @{ Authorization = "Bearer $env:HEARTH_AI_API_KEY" } -ContentType 'application/json; charset=utf-8' -Body ($prompt | ConvertTo-Json -Depth 15 -Compress) -TimeoutSec 30
                $candidate = [string]$aiResponse.choices[0].message.content
                if (-not [string]::IsNullOrWhiteSpace($candidate)) { $answer = $candidate.Trim(); $assistantMode = 'configured-ai' }
            } catch { Write-Warning 'Configured AI provider failed; the local contextual reply was used.' }
        }
        Send-Json $Context @{ answer = $answer; mode = $assistantMode; medicalAdvice = $false }
        return
    }

    if ($path.StartsWith('/api/')) { Send-Error $Context 404 'API route not found.'; return }
    Send-StaticFile $Context $path
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$script:Port/")
$listener.Start()
Write-Host "Hearth is running at http://127.0.0.1:$script:Port/"
Write-Host "Local demo only. Do not enter real patient information. Press Ctrl+C to stop."
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try { Handle-Request $context }
        catch {
            Write-Warning $_.Exception.Message
            try { Send-Error $context 500 'The local service could not complete the request.' } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
