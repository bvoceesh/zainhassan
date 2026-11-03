(() => {
  const asArray = value => Array.isArray(value) ? value : value && Object.keys(value).length ? [value] : [];
  const firstName = name => {
    const parts = String(name || '').split(/\s+/);
    return parts[0].toLowerCase() === 'dr.' ? (parts[1] || parts[0]) : parts[0];
  };
  const dateText = value => value ? new Date(value).toLocaleDateString() : 'Not scheduled';
  const statusClass = value => value === 'accepted' ? 'green' : value === 'declined' ? 'gray' : 'yellow';

  function setUser(user) {
    state.authenticated = true;
    state.userId = user.id;
    state.userName = user.name;
    state.role = user.role;
    state.page = 'Overview';
    state.chat = [{ from: 'ai', text: `Welcome, ${firstName(user.name)}. Your account is connected to the local care service.` }];
  }

  async function refreshRemote() {
    const data = await window.hearthApi.dashboard();
    state.remoteData = data;
    state.backendAppointments = asArray(data.appointments);
    state.backendRequests = asArray(data.volunteerRequests);
    state.backendAvailability = asArray(data.availability);
    state.backendMedications = asArray(data.medications);
    state.backendPatients = [];
    state.backendFiles = asArray(data.files).map(file => ({
      id: file.id,
      name: file.name,
      type: file.category || 'Care file',
      date: file.createdAt ? dateText(file.createdAt) : 'Today'
    }));
    state.files = state.backendFiles;
    const plan = asArray(data.dietPlan)[0];
    state.backendDietPlan = plan || null;
    if (state.role === 'doctor' || state.role === 'unit') {
      const people = await window.hearthApi.patients();
      state.backendPatients = asArray(people.items);
    }
    const ownAvailability = state.backendAvailability.find(item => item.doctorId === state.userId);
    state.available = Boolean(ownAvailability && ownAvailability.available);
  }

  function card(title, content, description = '') {
    return `<div class="card"><div class="card-head"><div><h3 class="card-title">${esc(title)}</h3>${description ? `<div class="card-desc">${esc(description)}</div>` : ''}</div></div>${content}</div>`;
  }

  function connectedHome() {
    const data = state.remoteData || {};
    const appointments = asArray(state.backendAppointments);
    const requests = asArray(state.backendRequests);
    const files = asArray(state.backendFiles);
    const meds = asArray(state.backendMedications);
    const people = asArray(state.backendPatients);
    const available = asArray(state.backendAvailability).filter(item => item.available);

    if (state.role === 'patient') {
      const next = appointments.find(item => item.status !== 'declined');
      const medicationContent = meds.length
        ? meds.map(item => `<div class="medicine-card"><div class="med-time">${esc(item.schedule || 'Schedule not entered')} · ${esc(item.foodInstruction || 'Follow clinician instructions')}</div><div class="med-name">${esc(item.name)} · ${esc(item.dose || 'Dose not entered')}</div><div class="med-meta">Added by your care team. Contact your clinician if you have questions.</div></div>`).join('')
        : '<div class="care-note"><span class="note-icon">ⓘ</span><p>Your clinician has not added a medication routine to this account. Contact your care team before taking or changing medication.</p></div>';
      const careAvailability = available.length
        ? available.map(item => `<div class="doctor-row"><div class="doc-avatar">${esc(item.doctorName.split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</div><div class="row-main"><strong>${esc(item.doctorName)}</strong><span>${esc(item.schedule || 'Availability not set')}</span></div><span class="pill green">Available</span></div>`).join('')
        : '<div class="care-note"><span class="note-icon">◷</span><p>No clinician availability has been published to this account yet.</p></div>';
      return `${pageHead(`Welcome, ${esc(firstName(state.userName))}`, 'Your private care space, connected to your account.')} ${banner('Care, coordinated around you.','Review your clinician-shared plan, appointments, and practical support.','navigate-care')} ${statGrid([['Medication plan',meds.length ? `${meds.length} items` : 'Not shared',meds.length ? 'Entered by your care team' : 'Ask your clinician to add it','◷'],['Next appointment',next ? dateText(next.preferredDate) : 'Not scheduled',next ? next.status : 'Request a time','▦'],['Care files',files.length, 'Saved to this account','▤']])}<div class="two-col"><div>${section('Clinician-shared medication plan','Only schedules entered by your care team appear here')}${medicationContent}</div><div>${section('Doctor availability','Published by clinicians in this workspace')}${card('Available care team',careAvailability)}${section('Food & comfort plan')}${card('Your plan',state.backendDietPlan ? `<p class="card-desc">${esc(state.backendDietPlan.note || 'No note entered.')}</p><div class="care-note"><span class="note-icon">◷</span><p>${esc(state.backendDietPlan.reminder || 'No reminder selected')}</p></div>` : '<p class="card-desc">Your team has not added a plan to this account yet.</p><button class="mini-link" data-action="diet">Share preferences</button>')}</div></div>${section('Appointments & practical support')}<div class="two-col">${card('Your appointments',appointments.length ? appointments.map(item => `<div class="appointment-row"><div class="row-main"><strong>${esc(item.type || 'Care visit')}</strong><span>${esc(dateText(item.preferredDate))} · ${esc(item.preferredTime || '')}</span></div><span class="pill ${statusClass(item.status)}">${esc(item.status)}</span></div>`).join('') : '<p class="card-desc">No appointment requests yet.</p><button class="mini-link" data-action="book">Request a visit</button>')}${card('Volunteer support',requests.length ? requests.map(item => `<div class="request-row"><div class="row-main"><strong>${esc(item.support)}</strong><span>${esc(item.area || 'Area shared after match')} · ${esc(item.status)}</span></div></div>`).join('') : '<p class="card-desc">Request companionship, errands, or practical help.</p>')}<button class="action-btn coral" data-action="request-volunteer">Request a visit</button></div></div>`;
    }

    if (state.role === 'volunteer') {
      return `${pageHead(`Welcome, ${esc(firstName(state.userName))}`, 'Open requests shared by patients in your care community.')} ${statGrid([['Open requests',requests.filter(item => item.status === 'open').length,'Approximate area only','⌖'],['Your accepted visits',requests.filter(item => item.acceptedBy === state.userId).length,'Coordinate with the care team','♡'],['Care team contacts','Available','Contact after matching','✉']])}${section('Requests near you','Patient details stay private until a request is accepted')}<div class="card">${requests.length ? requests.map(item => `<div class="request-row"><div class="doc-avatar">${esc(String(item.patientName || 'P').split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</div><div class="row-main"><strong>${esc(item.support)} <span class="pill gray">${esc(item.area || 'Area not shared')}</span></strong><span>${esc(item.details || 'Support requested')} · ${esc(dateText(item.createdAt))}</span><span>Coordinate with the care team before the visit.</span></div>${item.status === 'open' ? `<button class="action-btn" data-action="accept-request" data-id="${esc(item.id)}">Accept</button>` : `<span class="pill green">Matched</span>`}</div>`).join('') : '<div class="empty-state">No patient requests have been shared with this volunteer account yet.</div>'}</div>`;
    }

    if (state.role === 'doctor') {
      const pending = appointments.filter(item => item.status === 'pending');
      return `${pageHead(`Welcome, ${esc(firstName(state.userName))}`, 'Your schedule and patient coordination workspace.')} ${statGrid([['Appointment requests',pending.length,'Awaiting your review','▦'],['Patients',people.length,'Registered in this local workspace','♧'],['Your availability',state.available ? 'Open' : 'Away',state.available ? 'Visible to patients' : 'Not bookable','◷']])}<div class="section-row"><div><h2 class="section-title">Availability</h2><div class="section-sub">Patients can see your published schedule</div></div><button class="action-btn secondary" data-action="availability">${state.available ? 'Set away' : 'Set available'}</button></div>${card('Your schedule',`<p class="card-desc">${esc((state.backendAvailability.find(item => item.doctorId === state.userId) || {}).schedule || 'No clinic hours published yet.')}</p><button class="mini-link" data-action="availability-edit">Edit hours</button>`)}${section('Appointment requests')}<div class="card">${appointments.length ? appointments.map(item => `<div class="appointment-row"><div class="doc-avatar">${esc(String(item.patientName || 'P').split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</div><div class="row-main"><strong>${esc(item.patientName || 'Patient')}</strong><span>${esc(item.type || 'Care visit')} · ${esc(dateText(item.preferredDate))} · ${esc(item.preferredTime || '')}</span></div><span class="pill ${statusClass(item.status)}">${esc(item.status)}</span>${item.status === 'pending' ? `<button class="mini-link" data-action="appointment-accept" data-id="${esc(item.id)}">Accept</button><button class="mini-link" data-action="appointment-decline" data-id="${esc(item.id)}">Decline</button>` : ''}</div>`).join('') : '<div class="empty-state">No appointment requests yet.</div>'}</div>${section('Patient accounts','Upload reports or add a clinician-approved medication schedule')}<div class="card">${people.length ? people.map(person => `<div class="person-row"><div class="doc-avatar">${esc(String(person.name).split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</div><div class="row-main"><strong>${esc(person.name)}</strong><span>${esc(person.email)}</span></div><button class="mini-link" data-action="report" data-patient="${esc(person.id)}">Upload report</button><button class="mini-link" data-action="add-medication" data-patient="${esc(person.id)}">Add medication</button></div>`).join('') : '<div class="empty-state">Patients must register before records can be linked to them.</div>'}</div>`;
    }

    return `${pageHead(`Welcome, ${esc(firstName(state.userName))}`, 'Shared overview of registered care activity.')} ${statGrid([['Patient accounts',people.length,'In this local workspace','♧'],['Appointments',appointments.length,'Requests and scheduled visits','▦'],['Volunteer requests',requests.filter(item => item.status === 'open').length,'Awaiting a match','✳']])}${section('Care team activity')}<div class="two-col">${card('Volunteer requests',requests.length ? requests.map(item => `<div class="request-row"><div class="row-main"><strong>${esc(item.patientName)} · ${esc(item.support)}</strong><span>${esc(item.area || 'Area not shared')} · ${esc(item.status)}</span></div></div>`).join('') : '<div class="empty-state">No requests yet.</div>')}${card('Published availability',available.length ? available.map(item => `<div class="doctor-row"><div class="row-main"><strong>${esc(item.doctorName)}</strong><span>${esc(item.schedule || 'Hours not set')}</span></div><span class="pill green">Available</span></div>`).join('') : '<p class="card-desc">No clinician hours published.</p>')}</div>`;
  }

  function connectedFiles() {
    const files = asArray(state.backendFiles);
    return `${pageHead('Care files','Documents stored in this account’s local record.')}<div class="card"><div class="card-head"><div><h3 class="card-title">Your documents</h3><div class="card-desc">Uploaded files are stored on this device.</div></div><label class="action-btn upload-label">＋ Upload file<input type="file" id="file-upload" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" multiple></label></div>${files.length ? files.map(file => `<div class="file-row"><div class="doc-avatar" style="border-radius:7px">▤</div><div class="row-main"><strong>${esc(file.name)}</strong><span>${esc(file.type || 'Care file')} · ${esc(file.date || 'Today')}</span></div><button class="mini-link" data-action="file-open" data-id="${esc(file.id)}">Download</button></div>`).join('') : '<div class="empty-state">No files saved to this account yet.</div>'}</div>`;
  }

  function connectedAppointments() {
    const items = asArray(state.backendAppointments);
    const doctor = state.role === 'doctor';
    return `${pageHead('Appointments',doctor?'Review patient requests and publish your availability.':'Request and review your care visits.')}<div class="toolbar" style="margin-bottom:13px">${doctor?'<button class="action-btn secondary" data-action="availability-edit">Edit availability</button>':'<button class="action-btn" data-action="book">Request an appointment</button>'}</div><div class="card table-wrap">${items.length ? `<table class="data-table"><thead><tr><th>${doctor?'Patient':'Visit'}</th><th>When</th><th>Status</th><th>Action</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(doctor ? item.patientName : item.type)}</strong></td><td>${esc(dateText(item.preferredDate))} · ${esc(item.preferredTime || '')}</td><td><span class="pill ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${doctor && item.status === 'pending' ? `<button class="mini-link" data-action="appointment-accept" data-id="${esc(item.id)}">Accept</button><button class="mini-link" data-action="appointment-decline" data-id="${esc(item.id)}">Decline</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No appointment records are linked to this account yet.</div>'}</div>`;
  }

  function connectedCarePlan() {
    const meds = asArray(state.backendMedications);
    const plan = state.backendDietPlan;
    const medicationRows = meds.length ? meds.map(item => `<div class="medicine-card"><div class="med-time">${esc(item.schedule || 'Schedule not entered')} · ${esc(item.foodInstruction || 'Follow clinician instructions')}</div><div class="med-name">${esc(item.name)} · ${esc(item.dose || 'Dose not entered')}</div><div class="med-meta">Entered by your care team. Ask your clinician if you are unsure.</div></div>`).join('') : '<div class="empty-state">No clinician-approved medication routine has been entered for this account.</div>';
    return `${pageHead('My care plan','Information entered by your care team.')}<div class="two-col">${card('Medication routine',medicationRows,'Check with your clinician before changing any medication.')}${card('Food & comfort plan',plan ? `<p class="card-desc">${esc(plan.note || '')}</p><div class="care-note"><span class="note-icon">◷</span><p>${esc(plan.reminder || 'No reminder selected')}</p></div><button class="mini-link" data-action="diet">Update preferences</button>` : '<p class="card-desc">Your team has not added a food and comfort plan yet.</p><button class="mini-link" data-action="diet">Share preferences</button>')}</div>`;
  }

  function connectedVolunteerPage() {
    const items = asArray(state.backendRequests);
    const patient = state.role === 'patient';
    return `${pageHead(patient?'Volunteer support':'Nearby requests','Patient locations stay approximate until support is matched.')}<div class="card">${patient?'<button class="action-btn coral" data-action="request-volunteer">Request a visit</button>':''}${items.length ? items.map(item => `<div class="request-row"><div class="doc-avatar">${esc(String(item.patientName || 'P').split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</div><div class="row-main"><strong>${esc(item.support)} · ${esc(item.area || 'Area not shared')}</strong><span>${esc(item.details || 'Support requested')} · ${esc(item.status)}</span></div>${!patient && item.status === 'open' ? `<button class="action-btn" data-action="accept-request" data-id="${esc(item.id)}">Accept</button>` : `<span class="pill ${statusClass(item.status)}">${esc(item.status)}</span>`}</div>`).join('') : '<div class="empty-state">No volunteer requests are linked to this account yet.</div>'}</div>`;
  }

  function renderConnectedContent() {
    let html;
    if (state.page === 'Overview') html = connectedHome();
    else if (state.page === 'Appointments' || state.page === 'Schedule') html = connectedAppointments();
    else if (state.page === 'My files' || state.page === 'Reports') html = connectedFiles();
    else if (state.page === 'My care plan') html = connectedCarePlan();
    else if (['Volunteer help', 'Nearby requests', 'Volunteers'].includes(state.page)) html = connectedVolunteerPage();
    else html = `${pageHead(esc(state.page),'Your account-linked care workspace.')}<div class="card"><div class="empty-state">This section is ready for records shared with your care team.</div></div>`;
    document.getElementById('content').innerHTML = html;
    navRender();
    const accountButton = document.querySelector('.account-btn');
    if (accountButton) accountButton.textContent = 'Sign out';
  }

  function openRequestModal() {
    openModal('Request volunteer support', `<div class="form-field"><label for="request-support">What would help?</label><select id="request-support"><option>Companionship</option><option>Errands</option><option>Transportation</option><option>Help at home</option><option>Other</option></select></div><div class="form-field"><label for="request-area">Approximate area</label><input id="request-area" maxlength="100" placeholder="Neighborhood or care unit"></div><div class="form-field"><label for="request-details">Anything the volunteer should know?</label><textarea id="request-details" rows="3" maxlength="1000" placeholder="Share only what you are comfortable sharing"></textarea></div><div class="form-hint">Your exact address is not requested. Coordinate visit details directly with your care team.</div>`, 'Send request');
  }

  function openMedicationModal(patientId) {
    openModal('Add clinician-approved medication', `<input id="med-patient" type="hidden" value="${esc(patientId)}"><div class="form-field"><label for="med-name">Medication name</label><input id="med-name" maxlength="100" required></div><div class="form-field"><label for="med-dose">Dose as prescribed</label><input id="med-dose" maxlength="100" placeholder="Enter the clinician-provided dose"></div><div class="form-field"><label for="med-schedule">Time and frequency</label><input id="med-schedule" maxlength="100" placeholder="e.g. 12:30 PM daily"></div><div class="form-field"><label for="med-food">Food instructions</label><input id="med-food" maxlength="200" placeholder="Use the exact instruction from the prescription"></div><div class="form-hint">Only enter instructions from a verified prescription. This local demo is not a prescribing system.</div>`, 'Add to care plan');
  }

  function reportModal(patientId) {
    actionModal('report');
    const select = document.getElementById('report-patient');
    if (select) {
      select.innerHTML = asArray(state.backendPatients).map(person => `<option value="${esc(person.id)}" ${person.id === patientId ? 'selected' : ''}>${esc(person.name)}</option>`).join('');
      if (!select.options.length) select.innerHTML = '<option value="">No patient accounts registered</option>';
    }
  }

  async function perform(task, successMessage) {
    try { await task(); if (successMessage) toast(successMessage); }
    catch (error) { toast(error.message || 'The local service could not complete the request.'); }
  }

  function showAuth() {
    authModal = function(mode = 'login') {
      const registering = mode === 'register';
      const recovering = mode === 'recover';
      const roles = `<option value="patient" ${state.role === 'patient' ? 'selected' : ''}>Patient or family member</option><option value="volunteer" ${state.role === 'volunteer' ? 'selected' : ''}>Volunteer</option><option value="doctor" ${state.role === 'doctor' ? 'selected' : ''}>Clinician</option><option value="unit" ${state.role === 'unit' ? 'selected' : ''}>Palliative care unit</option>`;
      const title = recovering ? 'Recover your password' : (registering ? 'Create your Hearth account' : 'Sign in to Hearth');
      const formBody = recovering ? `<input id="auth-mode-type" type="hidden" value="recover"><div class="form-field"><label for="auth-email">Email address</label><input id="auth-email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="form-field"><label for="auth-password">New password</label><input id="auth-password" type="password" required minlength="10" autocomplete="new-password" placeholder="At least 10 characters"></div><div class="form-field"><label for="auth-confirm-password">Confirm password</label><input id="auth-confirm-password" type="password" required minlength="10" autocomplete="new-password" placeholder="Re-enter your password"></div><div class="form-hint">This local demo resets the password on this device. Use the account email to set a replacement password.</div>` : `<input id="auth-mode-type" type="hidden" value="${registering ? 'register' : 'login'}">${registering ? `<div class="form-field"><label for="auth-name">Your name</label><input id="auth-name" required minlength="2" maxlength="100" value="${esc(state.userName)}"></div>` : `<input id="auth-name" type="hidden" value="${esc(state.userName)}">`}<div class="form-field"><label for="auth-email">Email address</label><input id="auth-email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="form-field"><label for="auth-password">Password</label><input id="auth-password" type="password" required minlength="10" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="At least 10 characters"></div>${registering ? `<div class="form-field"><label for="auth-role">I’m joining as</label><select id="auth-role">${roles}</select></div>` : `<input id="auth-role" type="hidden" value="${state.role}"><div class="form-row-inline"><button class="auth-link" type="button" data-auth-mode="recover">Forgot password?</button></div>`}<div class="form-hint">This local app stores password hashes on this device. Do not use a real password or patient information.</div>`;
      openModal(title, `<div class="auth-modes"><button class="auth-mode ${registering ? '' : 'active'}" data-auth-mode="login">Sign in</button><button class="auth-mode ${registering ? 'active' : ''}" data-auth-mode="register">Create account</button></div>${formBody}`, recovering ? 'Update password' : 'Continue');
    };
  }

  window.addEventListener('click', async event => {
    const mode = event.target.closest('[data-auth-mode]');
    if (mode) { event.preventDefault(); event.stopPropagation(); authModal(mode.dataset.authMode); return; }

    const submit = event.target.closest('[data-action="modal-submit"]');
    if (submit && document.getElementById('auth-email')) {
      event.preventDefault(); event.stopPropagation();
      const authMode = document.getElementById('auth-mode-type') ? document.getElementById('auth-mode-type').value : 'login';
      const registering = authMode === 'register';
      const recovering = authMode === 'recover';
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      if (recovering) {
        const confirmPassword = document.getElementById('auth-confirm-password').value;
        if (password.length < 10 || confirmPassword.length < 10) { toast('Use a password with at least 10 characters.'); return; }
        if (password !== confirmPassword) { toast('The new password and confirmation do not match.'); return; }
      }
      const body = { email, password };
      if (registering) { body.name = document.getElementById('auth-name').value.trim(); body.role = document.getElementById('auth-role').value; }
      await perform(async () => {
        if (recovering) {
          await window.hearthApi.resetPassword({ email, password });
          closeModal();
          authModal('login');
          return;
        }
        const result = registering ? await window.hearthApi.register(body) : await window.hearthApi.login(body);
        setUser(result.user);
        await refreshRemote();
        closeModal();
        render();
      }, recovering ? 'Password updated. You can sign in with your new password.' : (registering ? 'Account created on this device.' : 'Signed in.'));
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'auth' && state.authenticated) {
      event.preventDefault(); event.stopPropagation();
      await perform(async () => { await window.hearthApi.logout(); state.authenticated = false; state.userId = null; state.userName = ''; state.role = 'patient'; state.page = 'Overview'; state.remoteData = null; state.backendAppointments = []; state.backendRequests = []; state.backendAvailability = []; state.backendMedications = []; state.backendPatients = []; state.backendFiles = []; state.files = []; state.backendDietPlan = null; state.available = false; render(); }, 'Signed out.');
      return;
    }
    if (!state.authenticated) return;

    if (action === 'request-volunteer') {
      event.preventDefault(); event.stopPropagation(); openRequestModal(); return;
    }
    if (action === 'report' && state.role === 'doctor') {
      event.preventDefault(); event.stopPropagation(); reportModal(button.dataset.patient || ''); return;
    }
    if (action === 'add-medication' && state.role === 'doctor') {
      event.preventDefault(); event.stopPropagation(); openMedicationModal(button.dataset.patient); return;
    }
    if (action === 'availability' || action === 'availability-edit') {
      event.preventDefault(); event.stopPropagation();
      if (action === 'availability') {
        await perform(async () => { await window.hearthApi.saveAvailability({ available: !state.available, schedule: 'Mon–Fri · 9:00 AM–5:00 PM' }); state.available = !state.available; await refreshRemote(); render(); }, 'Availability updated.');
      } else {
        openModal('Publish your availability', `<div class="form-field"><label for="available-hours">Clinic hours</label><input id="available-hours" maxlength="100" value="${esc((state.backendAvailability.find(item => item.doctorId === state.userId) || {}).schedule || 'Mon-Fri · 9:00 AM-5:00 PM')}"></div>`, 'Save hours');
      }
      return;
    }
    if (action === 'diet') { event.preventDefault(); event.stopPropagation(); actionModal('diet'); const note = document.getElementById('meal-note'); const reminder = document.getElementById('meal-reminder'); if (note && state.backendDietPlan) note.value = state.backendDietPlan.note || ''; if (reminder && state.backendDietPlan) reminder.value = state.backendDietPlan.reminder || reminder.value; return; }
    if (action === 'book') { event.preventDefault(); event.stopPropagation(); actionModal('book'); return; }
    if (action === 'accept-request') {
      event.preventDefault(); event.stopPropagation();
      await perform(async () => { await window.hearthApi.acceptVolunteerRequest(button.dataset.id); await refreshRemote(); render(); }, 'Request accepted. Coordinate through your care team.');
      return;
    }
    if (action === 'appointment-accept' || action === 'appointment-decline') {
      event.preventDefault(); event.stopPropagation();
      await perform(async () => { await window.hearthApi.respondAppointment(button.dataset.id, action.endsWith('accept') ? 'accept' : 'decline'); await refreshRemote(); render(); }, 'Appointment response saved.');
      return;
    }
    if (action === 'file-open' && button.dataset.id) {
      event.preventDefault(); event.stopPropagation();
      await perform(async () => { const response = await fetch(`/api/files/${button.dataset.id}`, { credentials: 'same-origin' }); if (!response.ok) throw new Error('File could not be downloaded.'); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = button.closest('.file-row').querySelector('strong').textContent; link.click(); URL.revokeObjectURL(link.href); }, '');
    }
  }, true);

  window.addEventListener('click', async event => {
    const submit = event.target.closest('[data-action="modal-submit"]');
    if (!submit || !state.authenticated || document.getElementById('auth-email')) return;
    const requestArea = document.getElementById('request-area');
    const mealNote = document.getElementById('meal-note');
    const bookDate = document.getElementById('book-date');
    const reportFile = document.getElementById('report-file');
    const medicationName = document.getElementById('med-name');
    const availabilityHours = document.getElementById('available-hours');
    if (!(requestArea || mealNote || bookDate || reportFile || medicationName || availabilityHours)) return;
    event.preventDefault(); event.stopPropagation();
    if (requestArea) {
      await perform(async () => { await window.hearthApi.createVolunteerRequest({ support: document.getElementById('request-support').value, area: requestArea.value.trim(), details: document.getElementById('request-details').value.trim() }); state.volunteerRequested = true; await refreshRemote(); closeModal(); render(); }, 'Your request was added to the care team queue.');
    } else if (mealNote) {
      await perform(async () => { await window.hearthApi.saveDietPlan({ note: mealNote.value.trim(), reminder: document.getElementById('meal-reminder').value }); await refreshRemote(); closeModal(); render(); }, 'Food preferences saved.');
    } else if (bookDate) {
      await perform(async () => { await window.hearthApi.requestAppointment({ type: 'Palliative care visit', preferredDate: bookDate.value, preferredTime: document.getElementById('book-time').value, note: document.getElementById('book-note').value.trim() }); await refreshRemote(); closeModal(); render(); }, 'Appointment request sent.');
    } else if (reportFile) {
      if (!reportFile.files.length) { toast('Choose a report file to upload.'); return; }
      await perform(async () => { await window.hearthApi.uploadFile(reportFile.files[0], 'Clinician report', document.getElementById('report-patient').value); await refreshRemote(); closeModal(); render(); }, 'Report uploaded to the selected patient account.');
    } else if (medicationName) {
      await perform(async () => { await window.hearthApi.addMedication(document.getElementById('med-patient').value, { name: medicationName.value.trim(), dose: document.getElementById('med-dose').value.trim(), schedule: document.getElementById('med-schedule').value.trim(), foodInstruction: document.getElementById('med-food').value.trim() }); await refreshRemote(); closeModal(); render(); }, 'Medication plan added. Confirm all instructions against the prescription.');
    } else if (availabilityHours) {
      await perform(async () => { await window.hearthApi.saveAvailability({ available: state.available, schedule: availabilityHours.value.trim() }); await refreshRemote(); closeModal(); render(); }, 'Clinic hours published.');
    }
  }, true);

  window.addEventListener('change', async event => {
    if (event.target.id === 'role-switch' && state.authenticated) {
      event.preventDefault(); event.stopPropagation(); event.target.value = state.role; toast('Role access is fixed to this signed-in account.'); return;
    }
    if (event.target.id !== 'file-upload' || !state.authenticated) return;
    event.preventDefault(); event.stopPropagation();
    const files = [...event.target.files];
    await perform(async () => { for (const file of files) await window.hearthApi.uploadFile(file, 'Care file'); await refreshRemote(); render(); }, `${files.length} file(s) stored in this account.`);
  }, true);

  window.addEventListener('submit', async event => {
    if (event.target.id !== 'chat-form' || !state.authenticated) return;
    event.preventDefault(); event.stopPropagation();
    const input = document.getElementById('chat-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    state.chat.push({ from: 'user', text: question });
    try {
      const result = await window.hearthApi.askAssistant(question);
      state.chat.push({ from: 'ai', text: result.answer });
    } catch (error) {
      state.chat.push({ from: 'ai', text: error.message });
    }
    assistantRender();
  }, true);

  window.addEventListener('DOMContentLoaded', async () => {
    showAuth();
    const originalContentRender = contentRender;
    contentRender = function() {
      if (!state.authenticated) {
        const content = document.getElementById('content');
        if (content) {
          content.innerHTML = '<div class="card"><div class="empty-state">Sign in or create an account to view your care workspace.</div></div>';
        }
        const accountButton = document.querySelector('.account-btn');
        if (accountButton) accountButton.textContent = 'Sign in';
        return;
      }
      renderConnectedContent();
    };
    try {
      const result = await window.hearthApi.me();
      setUser(result.user);
      await refreshRemote();
      render();
    } catch (error) {
      state.authenticated = false;
      state.userName = '';
      const accountButton = document.querySelector('.account-btn');
      if (accountButton) accountButton.textContent = 'Sign in';
      render();
    }
  });
})();
