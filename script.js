// ========== CONFIGURATION ==========
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxcTkyKM9Ind9B40a4Drasn-pdenf_Sjzk7rTD_1I6tDj_KB8lMjhFKHR5L5y6MqHbe/exec"; 

// ========== STATE VARIABLES ==========
const SEC_ORDER = ['s1', 's2', 's3', 's4', 's5'];
const completedSecs = new Set();
let FACILITIES = [];
let DESK_DATA = {};
let CHECKLISTS = [];
let ORDER_GROUPS = [];
let ADMINS = []; 
let SESSION = {role: null, name: '', password: '', phone: '', facilityType: '', blockName: '', facilityName: '', isAdmin: false, isSuperAdmin: false, clientId: ''};
let assessorCount = 2;
let submissionPromise = null; // Thread lock tracking background upload processes

// Temporary file byte holder variables (Base64)
let fileStore = {
  report: { data: null, name: "", mime: "" },
  honor: { data: null, name: "", mime: "" },
  stateOrder: { data: null, name: "", mime: "" },
  distOrder: { data: null, name: "", mime: "" },
  edSheet: { data: null, name: "", mime: "" },
  admSheet: { data: null, name: "", mime: "" }
};

// ========== SECURITY ESCAPING UTIL (Stored XSS mitigation) ==========
function escapeHTML(str) {
  if (!str) return '';
  return str.toString().replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ========== SECURITY CRYPTOGRAPHIC HASHING UTIL (Plaintext transmission mitigation) ==========
async function hashPasswordSHA256(password) {
  if (!password) return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ========== PASSWORD VISIBILITY TOGGLE (SVG Path Swapping) ==========
function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPrivate = input.type === 'password';
  input.type = isPrivate ? 'text' : 'password';
  
  const eyePath = '<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />';
  const eyeSlashPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />';
  
  const svg = button.querySelector('svg');
  if (svg) {
    svg.innerHTML = isPrivate ? eyeSlashPath : eyePath;
  }
}

// ========== UTILS & SYSTEM VISUALS ==========
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function showErr(id,show){const el=document.getElementById(id);if(el)el.style.display=show?'block':'none';}
let _tt=null;
function toast(msg,type=''){
  const t=document.getElementById('toast');
  const m=document.getElementById('toast-msg');
  m.textContent=msg;
  t.className='toast'+(type?' '+type:'')+' show';
  if(_tt)clearTimeout(_tt);
  _tt=setTimeout(()=>t.classList.remove('show'),3200);
}

function showLoading(show, text = "Syncing with Google Database...") {
  const overlay = document.getElementById("loading-overlay");
  const overlayText = document.getElementById("loading-text");
  overlayText.textContent = text;
  overlay.style.display = show ? "flex" : "none";
}

function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  if(sb.classList.contains('open')){closeSidebar();}
  else{sb.classList.add('open');ov.style.display='block';}
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').style.display='none';
}

function parseDateString(str) {
  if (!str || str === 'Never Updated' || str === 'N/A' || str === 'Never') return null;
  try {
    let cleanStr = str.toLowerCase().replace('am', '').replace('pm', '').trim();
    const isPM = str.toLowerCase().includes('pm');
    const isAM = str.toLowerCase().includes('am');

    let parts = cleanStr.split(',');
    if (parts.length === 1) {
      parts = cleanStr.split(' ');
    }
    
    const datePart = parts[0].trim();
    const timePart = parts[1] ? parts[1].trim() : "00:00:00";
    
    let datePieces = datePart.split('/');
    if (datePieces.length === 1) {
      datePieces = datePart.split('-');
    }
    
    const timePieces = timePart.split(':');
    
    let day, month, year;
    if (parseInt(datePieces[0], 10) > 31) {
      year = parseInt(datePieces[0], 10);
      month = parseInt(datePieces[1], 10) - 1;
      day = parseInt(datePieces[2], 10);
    } else {
      day = parseInt(datePieces[0], 10);
      month = parseInt(datePieces[1], 10) - 1;
      year = parseInt(datePieces[2], 10);
    }
    
    let hours = parseInt(timePieces[0], 10);
    let minutes = parseInt(timePieces[1], 10) || 0;
    let seconds = parseInt(timePieces[2], 10) || 0;
    
    if (isPM && hours < 12) {
      hours += 12;
    } else if (isAM && hours === 12) {
      hours = 0;
    }
    
    const parsedDate = new Date(year, month, day, hours, minutes, seconds);
    return isNaN(parsedDate.getTime()) ? null : parsedDate;
  } catch (e) {
    return null;
  }
}

function getRelativeTime(timestamp) {
  if (!timestamp || timestamp === 'Never Updated' || timestamp === 'N/A' || timestamp === 'Never') return 'Never';
  try {
    const date = parseDateString(timestamp);
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now - date;
    if (diffMs < 0) return 'Just now'; 
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs} sec ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} hrs ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) {
      return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    }
    const diffWeeks = Math.floor(diffDays / 7);
    return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  } catch (e) {
    return 'Never';
  }
}

// ========== REST API GATEWAY CONNECTOR ==========
async function apiCall(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 seconds upload guard timeout

  try {
    if (SESSION.isAdmin && SESSION.name && SESSION.password) {
      payload.authUsername = SESSION.name;
      payload.authPassword = SESSION.password;
    }
    payload.clientId = SESSION.clientId;
    
    const response = await fetch(SHEET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    
    const result = await response.json();
    if (result.status === "error") {
      throw new Error(result.message);
    }
    return result.data;
  } catch (error) {
    clearTimeout(timeoutId);
    let errMsg = error.message;
    if (error.name === 'AbortError') {
      errMsg = "Transmission timed out. Please check your connectivity and file sizes.";
    }
    toast("Connection error: " + errMsg, "error");
    console.error(error);
    return null;
  }
}

// ========== BOOTSTRAPPING APPLICATION ==========
async function initPortal() {
  showLoading(true, "Synchronizing Portal Data...");
  const data = await apiCall({ action: "init", _timestamp: Date.now() });
  showLoading(false);
  
  if (data) {
    FACILITIES = data.facilities || [];
    CHECKLISTS = data.checklists || [];
    ORDER_GROUPS = data.orderGroups || [];
    
    populateInitialSelectors();
  }
}

function populateInitialSelectors() {
  const ftypeSel = document.getElementById('sel-ftype');
  ftypeSel.innerHTML = '<option value="">— Select Facility Type —</option>';
  const uniqueTypes = [...new Set(FACILITIES.map(f => f.type))].sort();
  uniqueTypes.forEach(t => ftypeSel.innerHTML += `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`);

  // Dropdown Bug Fixed: Populate the baseline administrative dashboard dropdown
  const admFtypeSel = document.getElementById('adm-sel-ftype');
  if (admFtypeSel) {
    admFtypeSel.innerHTML = '<option value="">— Facility Type —</option>';
    uniqueTypes.forEach(t => admFtypeSel.innerHTML += `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`);
  }

  // Dropdown Bug Fixed: Also populate S1 administrative browser dropdown
  const abrFtypeSel = document.getElementById('abr-ftype');
  if (abrFtypeSel) {
    abrFtypeSel.innerHTML = '<option value="">Type</option>';
    uniqueTypes.forEach(t => abrFtypeSel.innerHTML += `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`);
  }
}

// ========== ASSESSOR LOGIN CYCLE ==========
function openAssessorLogin(){openModal('modal-asr');setTimeout(()=>document.getElementById('a-name').focus(),100);}
function openAdminLogin(){openModal('modal-adm');setTimeout(()=>document.getElementById('adm-user').focus(),100);}

async function assessorNext(){
  const name=document.getElementById('a-name').value.trim();
  const phone=document.getElementById('a-phone').value.trim();
  let ok=true;
  if(!name){showErr('err-aname',true);ok=false;}else showErr('err-aname',false);
  if(!/^[6-9][0-9]{9}$/.test(phone)){showErr('err-aphone',true);ok=false;}else showErr('err-aphone',false);
  if(!ok)return;
  SESSION.name=name;SESSION.phone=phone;

  // OPTIMISTIC TRANSITION: Instantly step to facility modal without waiting for logging cycle to resolve
  closeModal('modal-asr');
  openModal('modal-fac');
  updateStepDots(1);

  apiCall({ action: "log_assessor_login", name: name, phone: "+91 " + phone });
}

function populateBlocks(){
  const ft=document.getElementById('sel-ftype').value;
  showErr('err-ftype',false);
  const blk=document.getElementById('sel-block');
  const fac=document.getElementById('sel-facility');
  blk.innerHTML='<option value="">— Select Block —</option>';
  fac.innerHTML='<option value="">— Select Facility —</option>';
  blk.disabled=!ft;fac.disabled=true;
  if(!ft)return;
  const blocks=[...new Set(FACILITIES.filter(f=>f.type===ft).map(f=>f.block))].sort();
  blocks.forEach(b=>blk.innerHTML+=`<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`);
  updateStepDots(1);
}
function populateFacilities(){
  const ft=document.getElementById('sel-ftype').value;
  const blk=document.getElementById('sel-block').value;
  showErr('err-block',false);
  const fac=document.getElementById('sel-facility');
  fac.innerHTML='<option value="">— Select Facility —</option>';
  fac.disabled=!blk;
  if(!blk)return;
  FACILITIES.filter(f=>f.type===ft&&f.block===blk).sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>fac.innerHTML+=`<option value="${escapeHTML(f.name)}">${escapeHTML(f.name)}</option>`);
}
function updateStepDots(step){
  for(let i=1;i<=3;i++){const d=document.getElementById('sd'+i);if(d)d.className='sd'+(i<=step?' active':'');}
}

async function facilityConfirm(){
  const ft=document.getElementById('sel-ftype').value;
  const blk=document.getElementById('sel-block').value;
  const fac=document.getElementById('sel-facility').value;
  let ok=true;
  if(!ft){showErr('err-ftype',true);ok=false;}else showErr('err-ftype',false);
  if(!blk){showErr('err-block',true);ok=false;}else showErr('err-block',false);
  if(!fac){showErr('err-fac',true);ok=false;}else showErr('err-fac',false);
  if(!ok)return;
  SESSION.facilityType=ft;SESSION.blockName=blk;SESSION.facilityName=fac;
  SESSION.role='assessor';SESSION.isAdmin=false;SESSION.isSuperAdmin=false;
  
  // OPTIMISTIC TRANSITION: Instantly route user to Audit Desk UI
  closeModal('modal-fac');
  launchPortal();

  // Handle logging asynchronously in background
  apiCall({ 
    action: "log_assessor_login", 
    name: SESSION.name, 
    phone: "+91 " + SESSION.phone,
    facilityType: ft,
    blockName: blk,
    facilityName: fac
  }).catch(err => console.error("Assessor login logging failed:", err));
  
  // Asynchronously retrieve single facility desk config payload
  apiCall({
    action: "get_facility_desk",
    facilityName: fac
  }).then(facDesk => {
    if (facDesk) {
      DESK_DATA[fac] = facDesk;
      loadDeskView(); // Re-render S1 dynamically once parameters resolve
    }
  }).catch(err => {
    console.error("Facility configurations sync failed:", err);
    toast("⚠ Could not pull latest configurations from database.", "error");
  });
}

// ========== ADMIN LOGIN ==========
async function adminLogin(){
  const u=document.getElementById('adm-user').value.trim();
  const p=document.getElementById('adm-pass').value;
  if(!u){showErr('err-admuser',true);return;}else{showErr('err-admuser',false);}
  if(!p){showErr('err-admpass',true);return;}else{showErr('err-admpass',false);}
  
  showLoading(true, "Authenticating Secure Session...");
  const hashedPass = await hashPasswordSHA256(p);
  const verifyRes = await apiCall({ action: "verify_admin", username: u, password: hashedPass });

  if(!verifyRes || !verifyRes.valid){
    showLoading(false);
    showErr('err-admpass',true);
    return;
  }
  showErr('err-admpass',false);
  
  SESSION.name = u;
  SESSION.password = hashedPass; 
  SESSION.role = 'admin';
  SESSION.isAdmin = true;
  SESSION.isSuperAdmin = !!verifyRes.isSuperAdmin;
  SESSION.facilityType = '';
  SESSION.blockName = '';
  SESSION.facilityName = '';
  
  const adminConfigs = await apiCall({ action: "get_admin_configs" });
  showLoading(false);

  if (adminConfigs) {
    DESK_DATA = adminConfigs.deskData || {};
    ADMINS = [
      { username: "Anil Sharma", isSuperAdmin: true },
      ...(adminConfigs.subAdmins || [])
    ];
  }

  // Log admin login to historical sheets
  apiCall({
    action: "log_admin_login",
    username: u,
    role: verifyRes.isSuperAdmin ? "Admin" : "Sub-Admin"
  }).catch(err => console.error("Telemetry error recording session authentication:", err));

  closeModal('modal-adm');
  launchPortal();
}

// ========== PORTAL HUB LAUNCHER ==========
function launchPortal(){
  document.getElementById('hdr-name').textContent=SESSION.name;
  document.getElementById('hdr-role').textContent=SESSION.isAdmin ? (SESSION.isSuperAdmin ? 'Admin' : 'Sub-Admin') : 'Assessor';
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('assess-date').value=today;
  
  const sandboxBanner = document.getElementById('admin-sandbox-banner');
  if (SESSION.isAdmin) {
    if (sandboxBanner) sandboxBanner.style.display = 'flex';
    document.getElementById('nav-admin').style.display='block';
    
    // Explicitly render datasets immediately on launch to solve blank lists bug
    renderChecklistTable();
    renderOrderTable();
    renderSubAdminTable();

    if(SESSION.isSuperAdmin) {
      goSec('admin-blocks');
      // Show block monitoring tabs for full administrators
      document.getElementById('nav-item-blocks').style.display = 'flex';
      document.getElementById('nav-item-dash').style.display = 'flex';
      
      document.getElementById('tab-btn-checklist').style.display = 'block';
      document.getElementById('tab-btn-orders').style.display = 'block';
      document.getElementById('tab-btn-admins').style.display = 'block';
    } else {
      // Sub-Admins: Restrict to Metadata Baseline tab ONLY (Redundant drop-down population removed)
      document.getElementById('nav-item-blocks').style.display = 'none';
      
      document.getElementById('tab-btn-checklist').style.display = 'none';
      document.getElementById('tab-btn-orders').style.display = 'none';
      document.getElementById('tab-btn-admins').style.display = 'none';
      
      adminTabSwitch('at-desk');
      goSec('admin-dash');
    }
  } else {
    if (sandboxBanner) sandboxBanner.style.display = 'none';
    document.getElementById('nav-admin').style.display='none';
    ['admin-bar-s1','admin-bar-s3','admin-bar-s5'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    goSec('s1');
    loadDeskView();
    renderChecklistDL();
    renderOrderList();
  }
  showScreen('s-welcome');
  showScreen('s-portal');
}

// ========== PORTAL NAVIGATION INTERFACES ==========
function goSec(id){
  // Enforce access control for Sub-Admins
  if (!SESSION.isSuperAdmin && id === 'admin-blocks') {
    toast("Unauthorized Access: Super-Admin clearance required.", "error");
    return;
  }

  const curActive=document.querySelector('.section-content.active');
  if(curActive){
    const prevId=curActive.id.replace('sec-','');
    if(SEC_ORDER.includes(prevId)){markComplete(prevId);}
  }
  
  document.querySelectorAll('.section-content').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const sec = document.getElementById('sec-' + id);
  if(sec) sec.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-sec="${id}"]`);
  if(nav) nav.classList.add('active');
  
  if(id === 'admin-blocks') {
    renderBlockStatusTable();
  }
  if(id === 's3') renderChecklistDL();
  if(id === 's5') renderOrderList();
  if(id === 's2') restoreSection2();
  
  window.scrollTo({top:0,behavior:'smooth'});
}

function markComplete(sec){
  completedSecs.add(sec);
  const nav=document.querySelector(`.nav-item[data-sec="${sec}"]`);
  if(nav){nav.classList.remove('active');nav.classList.add('completed');}
  updateProgressBar();
}

function updateProgressBar(){
  const pct=(completedSecs.size/5)*100;
  const bar=document.getElementById('progress-fill');
  if(bar)bar.style.width=pct+'%';
}

// ========== ASSESSOR DETAILED VIEW PANEL ==========
function loadDeskView(){
  const fn=SESSION.facilityName;
  document.getElementById('vi-fname').textContent=fn||'—';
  document.getElementById('vi-block').textContent=SESSION.blockName||'—';
  document.getElementById('vi-ftype').textContent=SESSION.facilityType||'—';
  const d=DESK_DATA[fn]||{};
  function fill(id,val){
    const el=document.getElementById(id);
    if(!el)return;
    if(val){el.innerHTML=escapeHTML(val);el.classList.remove('empty');}
    else{el.innerHTML='<span class="empty">Not filled yet</span>';}
  }
  fill('vi-incharge',d.incharge);
  
  // Directly render mobile configurations as-is (Mitigates "+91-+91" duplication bugs)
  fill('vi-mobile',d.mobile);
  fill('vi-nin',d.nin);
  fill('vi-saqsham',d.saqsham);
  
  ['m1n','m2n','m3n'].forEach((k,i)=>{
    const lbl=document.getElementById('vi-'+k);
    if(lbl)lbl.textContent=d[k]||`PSS CAPA Month ${i+1}`;
  });
  ['s1','s2','s3'].forEach(k=>{
    const el=document.getElementById('vi-'+k);
    if(!el)return;
    if(d[k]){el.textContent=d[k]+'%';el.classList.remove('empty');}
    else{el.textContent='— %';el.classList.add('empty');}
  });

  const viSheetContainer = document.getElementById('vi-sheet-container');
  if(viSheetContainer) {
    if(d.assessmentSheetUrl) {
      viSheetContainer.innerHTML = `
        <div class="dl-item" onclick="window.open('${escapeHTML(d.assessmentSheetUrl)}', '_blank')" style="border: 1.5px solid var(--success-border); background-color: var(--success-bg);">
          <div class="dl-icon" style="background-color: #ffffff; color: var(--success);">📊</div>
          <div class="dl-info">
            <strong style="color: var(--neutral-900); font-size: 0.9rem;">NQAS Facility Audit File</strong>
            <span style="color: var(--neutral-500); font-size: 0.78rem;">Download direct from Drive</span>
          </div>
          <button class="dl-btn" style="background-color: var(--success);">⬇ Download Excel</button>
        </div>
      `;
    } else {
      viSheetContainer.innerHTML = `
        <div style="text-align:center; padding:2rem; color:var(--neutral-500); font-style:italic; border: 1.5px dashed var(--neutral-300); border-radius: var(--radius-lg); font-size:0.88rem;">
          📊 NQAS Assessment Excel Sheet not uploaded yet by Administrator.
        </div>
      `;
    }
  }
}

// ========== DIRECT MODAL EDITING FOR ADMIN ON S1 ==========
function openEditDesk(){
  const fn=SESSION.facilityName;
  const d=DESK_DATA[fn]||{};
  document.getElementById('ed-incharge').value=d.incharge||'';
  document.getElementById('ed-mobile').value=d.mobile||'';
  document.getElementById('ed-saqsham').value=d.nin||''; 
  document.getElementById('ed-nin').value=d.saqsham||''; 
  document.getElementById('ed-m1n').value=d.m1n||'';
  document.getElementById('ed-m2n').value=d.m2n||'';
  document.getElementById('ed-m3n').value=d.m3n||'';
  document.getElementById('ed-s1').value=d.s1||'';
  document.getElementById('ed-s2').value=d.s2||'';
  document.getElementById('ed-s3').value=d.s3||'';

  const edSheetPreview = document.getElementById('ed-sheet-preview');
  if(d.assessmentSheetUrl) {
    document.getElementById('ed-sheet-name').textContent = "Uploaded NQAS Excel Template";
    if(edSheetPreview) edSheetPreview.style.display = 'block';
  } else {
    if(edSheetPreview) edSheetPreview.style.display = 'none';
  }
  document.getElementById('ed-sheet').value = '';
  fileStore.edSheet = { data: null, name: "", mime: "" };

  openModal('modal-edit-desk');
}

async function saveEditDesk(){
  const fn=SESSION.facilityName;
  const sheetFile = fileStore.edSheet;
  const backupData = JSON.parse(JSON.stringify(DESK_DATA[fn] || {})); // Deep backup for optimistic rollbacks

  const payload = {
    action: "save_desk",
    facilityType: SESSION.facilityType,
    blockName: SESSION.blockName,
    facilityName: fn,
    incharge: document.getElementById('ed-incharge').value.trim(),
    mobile: document.getElementById('ed-mobile').value.trim(),
    nin: document.getElementById('ed-saqsham').value.trim(),
    saqsham: document.getElementById('ed-nin').value.trim(),
    m1n: document.getElementById('ed-m1n').value.trim(),
    m2n: document.getElementById('ed-m2n').value.trim(),
    m3n: document.getElementById('ed-m3n').value.trim(),
    s1: document.getElementById('ed-s1').value.trim(),
    s2: document.getElementById('ed-s2').value.trim(),
    s3: document.getElementById('ed-s3').value.trim(),
    fileData: sheetFile.data,
    fileName: sheetFile.name,
    fileMime: sheetFile.mime,
    assessmentSheetUrl: DESK_DATA[fn]?.assessmentSheetUrl || "",
    editorRole: SESSION.isSuperAdmin ? "Admin" : "Sub-Admin",
    editorUsername: SESSION.name
  };

  // OPTIMISTIC UPDATE: Hydrate memory state and trigger DOM updates instantly
  DESK_DATA[fn] = {
    type: payload.facilityType,
    block: payload.blockName,
    incharge: payload.incharge,
    mobile: payload.mobile,
    nin: payload.nin,
    saqsham: payload.saqsham,
    assessmentSheetUrl: payload.assessmentSheetUrl, 
    m1n: payload.m1n,
    s1: payload.s1,
    m2n: payload.m2n,
    s2: payload.s2,
    m3n: payload.m3n,
    s3: payload.s3
  };

  loadDeskView();
  closeModal('modal-edit-desk');
  toast('⚙️ Syncing edits with the database...', 'success');

  apiCall(payload).then(res => {
    if (res) {
      if (res.fileUrl) {
        DESK_DATA[fn].assessmentSheetUrl = res.fileUrl;
        loadDeskView();
      }
      toast('✅ Configurations synced with database successfully.', 'success');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Background desk update sync failure:", err);
    DESK_DATA[fn] = backupData; // Rollback
    loadDeskView();
    toast('⚠ Database sync failed. Edits reverted.', 'error');
  });
}

// ========== DESK EDITING IN STANDALONE ADMIN DASHBOARD ==========
function admPopBlocks(){
  const ft=document.getElementById('adm-sel-ftype').value;
  const blk=document.getElementById('adm-sel-block');
  const fac=document.getElementById('adm-sel-facility');
  blk.innerHTML='<option value="">— Block —</option>';
  fac.innerHTML='<option value="">— Facility Name —</option>';
  blk.disabled=!ft;fac.disabled=true;
  if(!ft)return;
  const blocks=[...new Set(FACILITIES.filter(f=>f.type===ft).map(f=>f.block))].sort();
  blocks.forEach(b=>blk.innerHTML+=`<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`);
}
function admPopFacilities(){
  const ft=document.getElementById('adm-sel-ftype').value;
  const blk=document.getElementById('adm-sel-block').value;
  const fac=document.getElementById('adm-sel-facility');
  fac.innerHTML='<option value="">— Facility Name —</option>';
  fac.disabled=!blk;
  if(!blk)return;
  FACILITIES.filter(f=>f.type===ft&&f.block===blk).sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>fac.innerHTML+=`<option value="${escapeHTML(f.name)}">${escapeHTML(f.name)}</option>`);
}
function loadDeskData(){
  const fn=document.getElementById('adm-sel-facility').value;
  if(!fn)return;
  const d=DESK_DATA[fn]||{};
  document.getElementById('adm-incharge').value=d.incharge||'';
  document.getElementById('adm-mobile').value=d.mobile||'';
  document.getElementById('adm-nin').value=d.nin||'';
  document.getElementById('adm-saqsham').value=d.saqsham||'';
  document.getElementById('adm-m1n').value=d.m1n||'';
  document.getElementById('adm-m2n').value=d.m2n||'';
  document.getElementById('adm-m3n').value=d.m3n||'';
  document.getElementById('adm-s1').value=d.s1||'';
  document.getElementById('adm-s2').value=d.s2||'';
  document.getElementById('adm-s3').value=d.s3||'';

  const admSheetPreview = document.getElementById('adm-sheet-preview');
  if(d.assessmentSheetUrl) {
    document.getElementById('adm-sheet-name').textContent = "Uploaded NQAS Excel Template";
    if(admSheetPreview) admSheetPreview.style.display = 'block';
  } else {
    if(admSheetPreview) admSheetPreview.style.display = 'none';
  }
  document.getElementById('adm-sheet').value = '';
  fileStore.admSheet = { data: null, name: "", mime: "" };
}

async function saveDeskData(){
  const fn=document.getElementById('adm-sel-facility').value;
  if(!fn){toast('⚠ Select a facility first','error');return;}
  const sheetFile = fileStore.admSheet;
  const backupData = JSON.parse(JSON.stringify(DESK_DATA[fn] || {}));

  const payload = {
    action: "save_desk",
    facilityType: document.getElementById('adm-sel-ftype').value,
    blockName: document.getElementById('adm-sel-block').value,
    facilityName: fn,
    incharge: document.getElementById('adm-incharge').value.trim(),
    mobile: document.getElementById('adm-mobile').value.trim(),
    nin: document.getElementById('adm-nin').value.trim(),
    saqsham: document.getElementById('adm-saqsham').value.trim(),
    m1n: document.getElementById('adm-m1n').value.trim(),
    m2n: document.getElementById('adm-m2n').value.trim(),
    m3n: document.getElementById('adm-m3n').value.trim(),
    s1: document.getElementById('adm-s1').value.trim(),
    s2: document.getElementById('adm-s2').value.trim(),
    s3: document.getElementById('adm-s3').value.trim(),
    fileData: sheetFile.data,
    fileName: sheetFile.name,
    fileMime: sheetFile.mime,
    assessmentSheetUrl: DESK_DATA[fn]?.assessmentSheetUrl || "",
    editorRole: SESSION.isSuperAdmin ? "Admin" : "Sub-Admin",
    editorUsername: SESSION.name
  };

  // OPTIMISTIC UPDATE: Update cache memory instantaneously
  DESK_DATA[fn] = {
    type: payload.facilityType,
    block: payload.blockName,
    incharge: payload.incharge,
    mobile: payload.mobile,
    nin: payload.nin,
    saqsham: payload.saqsham,
    assessmentSheetUrl: payload.assessmentSheetUrl,
    m1n: payload.m1n,
    s1: payload.s1,
    m2n: payload.m2n,
    s2: payload.s2,
    m3n: payload.m3n,
    s3: payload.s3
  };

  toast('⚙️ Updating system configurations...', 'success');

  apiCall(payload).then(res => {
    if (res) {
      if (res.fileUrl) {
        DESK_DATA[fn].assessmentSheetUrl = res.fileUrl;
      }
      toast('✅ Saved! Desk details updated successfully.', 'success');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Standalone desk save background failure:", err);
    DESK_DATA[fn] = backupData; // Rollback
    loadDeskData(); // Rehydrate inputs
    toast('⚠ Database sync failed. Reverted to previous state.', 'error');
  });
}

// ========== FILE PARSING UTILITY (Base64) ==========
function handleAdminSheetUpload(prefix) {
  const fileInput = document.getElementById(prefix + '-sheet');
  const file = fileInput.files[0];
  if(!file) return;
  
  if(!/\.(xls|xlsx)$/i.test(file.name)) {
    toast('⚠ Only Excel files (.xls/.xlsx) are allowed', 'error');
    fileInput.value = '';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const storageKey = prefix === 'ed' ? 'edSheet' : 'admSheet';
    fileStore[storageKey] = {
      data: e.target.result,
      name: file.name,
      mime: file.type
    };
    const preview = document.getElementById(prefix + '-sheet-preview');
    const nameEl = document.getElementById(prefix + '-sheet-name');
    if (nameEl) nameEl.textContent = file.name;
    if (preview) preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ========== DYNAMIC ASSESSOR ADDITIONS ==========
function addAssessor(){
  if(assessorCount>=10){toast('Maximum 10 assessors can be registered','error');return;}
  assessorCount++;
  const ordinals=['','1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'];
  const ord=ordinals[assessorCount]||assessorCount+'th';
  const row=document.createElement('div');
  row.className='assessor-row';
  row.dataset.idx=assessorCount-1;
  row.innerHTML=`
    <div class="fg">
      <label>Assessor ${ord} Name</label>
      <input type="text" class="asr-name" placeholder="${ord} Assessor name"/>
    </div>
    <div></div>
    <div class="fg">
      <label>Contact Number</label>
      <div class="phone-row">
        <div class="phone-prefix">+91</div>
        <input type="tel" class="asr-phone" placeholder="10-digit" maxlength="10"/>
      </div>
    </div>
    <button class="btn-rm-asr" onclick="this.closest('.assessor-row').remove();assessorCount--;" title="Remove">✕</button>
  `;
  document.getElementById('assessor-list').appendChild(row);
  
  row.querySelector('input[type=tel]').addEventListener('input', function(){
    this.value=this.value.replace(/\D/g,'');
  });
}

// ========== CHECKLIST DYNAMICS ==========
async function addChecklist(){
  const n=document.getElementById('new-cl-name').value.trim();
  const ft=document.getElementById('new-cl-ftype').value;
  const url=document.getElementById('new-cl-url').value.trim();
  if(!n){toast('⚠ Please enter the document name','error');return;}

  const payload = {
    action: "add_checklist",
    name: n,
    type: ft,
    url: url,
    adminUsername: SESSION.name
  };

  // OPTIMISTIC ADD: Immediately update the list model and clear form input fields
  const tempIdx = CHECKLISTS.length;
  CHECKLISTS.push({ name: n, type: ft, url: url });
  renderChecklistTable();
  
  document.getElementById('new-cl-name').value='';
  document.getElementById('new-cl-url').value='';
  toast('⚙️ Distributing checklist updates...', 'success');

  apiCall(payload).then(res => {
    if (res) {
      toast('✅ Checklist published successfully.', 'success');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Checklist background sync failed:", err);
    CHECKLISTS.splice(tempIdx, 1); // Rollback
    renderChecklistTable();
    toast('⚠ Failed to publish checklist to database.', 'error');
  });
}

function renderChecklistTable(){
  const tbody=document.getElementById('cl-tbody');
  if(!tbody)return;
  if(!CHECKLISTS.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--neutral-500);padding:1.5rem;font-style:italic">No checklists available yet</td></tr>';return;}
  tbody.innerHTML=CHECKLISTS.map((c,i)=>`
    <tr>
      <td style="font-weight:600;">${escapeHTML(c.name)}</td>
      <td><span class="badge badge-pending" style="text-transform:none;">${escapeHTML(c.type)}</span></td>
      <td>${c.url?`<a href="${escapeHTML(c.url)}" target="_blank" style="color:var(--primary);font-weight:600;text-decoration:underline;">View Link ↗</a>`:'<span style="color:var(--neutral-500);font-style:italic;">Not set</span>'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteChecklist(${i})">Delete</button></td>
    </tr>
  `).join('');
}

async function deleteChecklist(i){
  const target = CHECKLISTS[i];
  
  // OPTIMISTIC REMOVE: Transition UI immediately
  CHECKLISTS.splice(i, 1);
  renderChecklistTable();
  toast('⚙️ Retiring checklist parameter...', 'success');

  apiCall({ action: "remove_checklist", name: target.name }).then(res => {
    if (res) {
      toast('Checklist parameter deleted');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Checklist deletion fallback:", err);
    CHECKLISTS.splice(i, 0, target); // Rollback
    renderChecklistTable();
    toast('⚠ Failed to remove checklist. Connection error.', 'error');
  });
}

function renderChecklistDL(){
  const list=document.getElementById('checklist-dl-list');
  if(!list)return;
  const ft=SESSION.facilityType;
  const items=CHECKLISTS.filter(c=>c.type==='All'||c.type===ft||!ft);
  if(!items.length){list.innerHTML='<div style="text-align:center;padding:2rem;color:var(--neutral-500);font-style:italic">📋 No checklists available yet</div>';return;}
  list.innerHTML=items.map(c=>`
    <div class="dl-item" onclick="${c.url?`window.open('${escapeHTML(c.url)}','_blank')`:''}">
      <div class="dl-icon">📄</div>
      <div class="dl-info"><strong>${escapeHTML(c.name)}</strong><span>Type: ${escapeHTML(c.type)}</span></div>
      ${c.url?`<button class="dl-btn">⬇ Download</button>`:'<span class="dl-na">Not available yet</span>'}
    </div>
  `).join('');
}

// ========== OFFICE ORDERS CONFIGURATION ==========
async function addOrderGroup(){
  const t=document.getElementById('new-og-title').value.trim();
  if(!t){toast('⚠ Please enter group title','error');return;}

  const payload = {
    action: "add_order_group",
    title: t,
    adminUsername: SESSION.name
  };

  // OPTIMISTIC ADD: Clear form input fields and push config details instantly
  const tempIdx = ORDER_GROUPS.length;
  ORDER_GROUPS.push({ title: t });
  renderOrderTable();
  toast('⚙️ Establishing administrative oversight cycle...', 'success');

  apiCall(payload).then(res => {
    if (res) {
      toast('✅ Order Group published successfully.', 'success');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Background order group publish failed:", err);
    ORDER_GROUPS.splice(tempIdx, 1); // Rollback
    renderOrderTable();
    toast('⚠ Failed to configure order group.', 'error');
  });
}

function renderOrderTable(){
  const tbody=document.getElementById('og-tbody');
  if(!tbody)return;
  if(!ORDER_GROUPS.length){tbody.innerHTML='<tr><td colspan="2" style="text-align:center;color:var(--neutral-500);padding:1.5rem;font-style:italic">No order groups added yet</td></tr>';return;}
  tbody.innerHTML=ORDER_GROUPS.map((g,i)=>`
    <tr>
      <td style="font-weight:600;">${escapeHTML(g.title)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteOrder(${i})">Delete</button></td>
    </tr>
  `).join('');
}

async function deleteOrder(i){
  const target = ORDER_GROUPS[i];
  
  // OPTIMISTIC REMOVE: Cascade mutations dynamically
  ORDER_GROUPS.splice(i, 1);
  renderOrderTable();
  toast('⚙️ Revoking administrative cycle...', 'success');

  apiCall({ action: "remove_order_group", title: target.title }).then(res => {
    if (res) {
      toast('Order Group parameters deleted');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Background order group deletion failure:", err);
    ORDER_GROUPS.splice(i, 0, target); // Rollback
    renderOrderTable();
    toast('⚠ Connection lost. Failed to delete order group.', 'error');
  });
}

let selectedOrder=null;
function renderOrderList(){
  const list=document.getElementById('order-list');
  if(!list)return;
  if(!ORDER_GROUPS.length){list.innerHTML='<div style="text-align:center;padding:2rem;color:var(--neutral-500);font-style:italic">No order groups added yet</div>';return;}
  list.innerHTML=ORDER_GROUPS.map((g,i)=>`
    <div class="order-item" id="oi-${i}" onclick="selectOrder(${i})">
      <div class="oi-header">
        <div class="oi-radio"></div>
        <div class="oi-title">${escapeHTML(g.title)}</div>
      </div>
    </div>
  `).join('');
}
function selectOrder(i){
  selectedOrder=i;
  document.querySelectorAll('.order-item').forEach((el,idx)=>el.classList.toggle('selected',idx===i));
  const uploadCard = document.getElementById('assessor-order-upload-card');
  if(uploadCard) uploadCard.style.display = 'block';
}

// ========== UPLOAD ENGINE MANAGEMENT ==========
function handleUpload(type, explicitFile = null){
  const fileInput=document.getElementById('file-'+type);
  const file=explicitFile || (fileInput ? fileInput.files[0] : null);
  if(!file)return;

  const maxMB=20;
  if(file.size>maxMB*1024*1024){
    toast(`⚠ File too large (max ${maxMB}MB)`,'error');
    if(fileInput) fileInput.value='';
    return;
  }
  if(type==='report'){
    if(!/\.(doc|docx)$/i.test(file.name)){
      toast('⚠ Only Word files (.doc/.docx) allowed','error');
      if(fileInput) fileInput.value='';
      return;
    }
  }
  if(type==='honor' || type==='state-order' || type==='dist-order'){
    if(!/\.pdf$/i.test(file.name)){
      toast('⚠ Only PDF files allowed','error');
      if(fileInput) fileInput.value='';
      return;
    }
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const storageKey = type.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    fileStore[storageKey] = {
      data: e.target.result,
      name: file.name,
      mime: file.type
    };
    
    const preview=document.getElementById('fp-'+type);
    const nameEl=document.getElementById('fp-'+type+'-name');
    if(nameEl) nameEl.textContent=file.name;
    if(preview) preview.style.display='flex';
    const uz=document.getElementById('uz-'+type);
    if(uz) uz.style.borderColor='var(--success)';
  };
  reader.readAsDataURL(file);
}

// ========== COMPOSITE SUBMIT ASSESSMENT (Optimistic Submit & Lifecycle Guard) ==========
async function submitAll(){
  const btn=document.getElementById('btn-submit');
  const date=document.getElementById('assess-date').value;
  if(!date){toast('⚠ Please select assessment date','error');goSec('s2');return;}
  if(selectedOrder===null&&ORDER_GROUPS.length>0){toast('⚠ Please select an Office Order Group','error');return;}
  
  if(selectedOrder!==null && (!fileStore.stateOrder.data || !fileStore.distOrder.data)) {
    toast('⚠ Please upload both State and District Order PDFs','error');
    return;
  }
  if(!fileStore.report.data || !fileStore.honor.data) {
    toast('⚠ Please upload Assessment Report and Honorarium Form','error');
    return;
  }

  btn.disabled=true;
  btn.textContent='Submitting...';

  const asrs=[];
  document.querySelectorAll('.assessor-row').forEach(row=>{
    const n=row.querySelector('.asr-name').value.trim();
    const p=row.querySelector('.asr-phone').value.trim();
    if(n)asrs.push({name:n,phone:p?'+91 ' + p:''});
  });

  const payload = {
    action: "submit_assessment",
    assessorName: SESSION.name,
    assessorPhone: "+91 " + SESSION.phone,
    facilityType: SESSION.facilityType,
    blockName: SESSION.blockName,
    facilityName: SESSION.facilityName,
    assessmentDate: date,
    assessors: asrs,
    orderGroup: selectedOrder !== null ? ORDER_GROUPS[selectedOrder]?.title : "None",
    
    reportData: fileStore.report.data,
    reportName: fileStore.report.name,
    reportMime: fileStore.report.mime,
    
    honorData: fileStore.honor.data,
    honorName: fileStore.honor.name,
    honorMime: fileStore.honor.mime,
    
    stateOrderData: fileStore.stateOrder.data,
    stateOrderName: fileStore.stateOrder.name,
    stateOrderMime: fileStore.stateOrder.mime,
    
    distOrderData: fileStore.distOrder.data,
    distOrderName: fileStore.distOrder.name,
    distOrderMime: fileStore.distOrder.mime
  };

  // OPTIMISTIC SUBMIT: Instantly load success modal before network payloads serialize
  openModal('modal-sub-success');
  document.getElementById('success-facility-name').textContent = SESSION.facilityName || "Demo Facility";

  if (SESSION.isAdmin) {
    submissionPromise = Promise.resolve({ success: true });
    return;
  }

  // Handle upload lifecycle thread asynchronously in the background
  submissionPromise = apiCall(payload).then(res => {
    if (res) {
      try{sessionStorage.removeItem('nqas_s2_'+SESSION.facilityName+'_'+SESSION.name);}catch(e){}
      toast("✅ Assessment upload complete. Registry safely archived.", "success");
      return res;
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Asynchronous submit assessment failed:", err);
    toast("⚠ CRITICAL ERROR: Database submission failed. Please keep this tab open and click Submit again.", "error");
    
    // Enable retry flow on S5
    btn.disabled=false;
    btn.textContent='🔒 Commit Assessment to Public Registry';
    
    // Close optimistic success modal to allow user to retry
    closeModal('modal-sub-success');
    submissionPromise = null;
  });
}

function goHome(){
  doLogout();
}

/**
 * Lifecycle Guard: Blocks the session reset until background submission completes safely.
 */
async function completeSessionLogout() {
  const okBtn = document.querySelector('#modal-sub-success .btn-teal');
  if (submissionPromise) {
    const originalText = okBtn.textContent;
    okBtn.disabled = true;
    okBtn.textContent = "⏳ Uploading bytes... please wait";
    try {
      await submissionPromise;
    } catch (e) {
      okBtn.disabled = false;
      okBtn.textContent = originalText;
      return; // Stop logout if background submission failed and user needs to retry
    }
  }
  closeModal('modal-sub-success');
  doLogout();
}

// ========== SUB-ADMIN MANAGEMENT ==========
async function createSubAdmin(){
  const u=document.getElementById('new-adm-user').value.trim();
  const p=document.getElementById('new-adm-pass').value.trim();
  if(!u||!p){toast('⚠ Please enter both username and password','error');return;}
  if(ADMINS.find(a=>a.username===u)){toast('⚠ Username already exists','error');return;}

  const hashedPass = await hashPasswordSHA256(p);
  const payload = {
    action: "add_sub_admin",
    username: u,
    password: hashedPass, // Pre-hashed on client side
    adminUsername: SESSION.name
  };

  // OPTIMISTIC ADD: Clear form inputs and push credentials instantly to UI
  const tempIdx = ADMINS.length;
  ADMINS.push({ username: u, createdAt: new Date().toLocaleString('en-IN') });
  document.getElementById('new-adm-user').value='';
  document.getElementById('new-adm-pass').value='';
  renderSubAdminTable();
  toast('⚙️ Issuing administrative security keys...', 'success');

  apiCall(payload).then(res => {
    if (res) {
      toast('✅ Sub-admin credentials registered.', 'success');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Background sub-admin creation failed:", err);
    ADMINS.splice(tempIdx, 1); // Rollback
    renderSubAdminTable();
    toast('⚠ Failed to register sub-admin. Sync error.', 'error');
  });
}

async function deleteSubAdmin(i){
  const target = ADMINS[i];
  if(target.isSuperAdmin){toast('⚠ Superadmin cannot be removed','error');return;}

  // OPTIMISTIC REMOVE: Instantly wipe privileges from memory array
  ADMINS.splice(i, 1);
  renderSubAdminTable();
  toast('⚙️ Revoking credentials...', 'success');

  apiCall({ action: "remove_sub_admin", username: target.username }).then(res => {
    if (res) {
      toast('Access privileges revoked');
    } else {
      throw new Error();
    }
  }).catch(err => {
    console.error("Background sub-admin removal failed:", err);
    ADMINS.splice(i, 0, target); // Rollback
    renderSubAdminTable();
    toast('⚠ Failed to revoke sub-admin privileges.', 'error');
  });
}

function renderSubAdminTable(){
  const tbody=document.getElementById('adm-tbody');
  if(!tbody)return;
  const subs=ADMINS.filter(a=>!a.isSuperAdmin);
  if(!subs.length){tbody.innerHTML='<tr><td colspan="3" style="text-align:center;color:var(--neutral-500);padding:1.5rem;font-style:italic">No sub-admins available yet</td></tr>';return;}
  tbody.innerHTML=subs.map((a,i)=>`
    <tr>
      <td style="font-weight:600;">${escapeHTML(a.username)}</td>
      <td>${escapeHTML(a.createdAt||'—')}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteSubAdmin(${ADMINS.indexOf(a)})">Remove</button></td>
    </tr>
  `).join('');
}

// ========== TIMELINE BLOCK MONITORING ENGINE ==========
function renderBlockStatusTable(){
  const container = document.getElementById('blocks-timeline-container');
  if(!container) return;
  
  const uniqueBlocks = [...new Set(FACILITIES.map(f=>f.block))].sort();
  let html = '';
  
  uniqueBlocks.forEach(block => {
    const blockFacs = FACILITIES.filter(f => f.block === block);
    const totalCount = blockFacs.length;
    let filledCount = 0;
    let facilitiesRows = '';
    
    blockFacs.forEach(fac => {
      const d = DESK_DATA[fac.name];
      let statusString = '';
      let relativeString = 'Never';
      let exactDateString = 'N/A';
      
      if (d && d.incharge && d.incharge.trim() !== '') {
        filledCount++;
        statusString = '<span style="color: var(--success); font-weight: 700; font-size: 0.85rem;">Filled</span>';
        
        // Data Mapping Fix: Verify d.lastUpdated represents a valid date format and is not a role string
        if (d.lastUpdated && d.lastUpdated.trim() !== '' && d.lastUpdated !== 'Admin' && d.lastUpdated !== 'Sub-Admin') {
          exactDateString = d.lastUpdated;
          relativeString = getRelativeTime(d.lastUpdated);
        }
      } else {
        statusString = '<span style="color: var(--danger); font-weight: 700; font-size: 0.85rem;">Not Filled</span>';
      }
      
      facilitiesRows += `
        <tr>
          <td style="font-weight: 600; font-size:0.85rem; color: var(--neutral-800);">${escapeHTML(fac.name)} <span style="font-size:0.7rem; color:var(--neutral-50); font-weight:400;">(${escapeHTML(fac.type)})</span></td>
          <td>${statusString}</td>
          <td style="font-size:0.78rem; font-weight:600; color:var(--neutral-60);">${escapeHTML(relativeString)}</td>
          <td style="font-size:0.78rem; color:var(--neutral-500);">${escapeHTML(exactDateString)}</td>
        </tr>
      `;
    });
    
    let blockBadge = '';
    if (filledCount === totalCount) {
      blockBadge = '<span class="badge badge-done">Completed</span>';
    } else if (filledCount > 0) {
      blockBadge = '<span class="badge badge-pending">Pending</span>';
    } else {
      blockBadge = '<span class="badge badge-pending" style="background-color: var(--neutral-100); color: var(--neutral-40); border-color: var(--neutral-200);">Not Started</span>';
    }
    
    html += `
      <div class="card block-status-card" data-block-name="${escapeHTML(block.toLowerCase())}" style="margin-bottom:0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--neutral-200); padding-bottom: 0.75rem; margin-bottom: 1rem; flex-wrap:wrap; gap:10px;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--primary-900);">🏢 Block: ${escapeHTML(block)}</h3>
          <div style="display: flex; gap: 12px; align-items: center;">
            ${blockBadge}
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--neutral-600); background-color:var(--neutral-50); padding: 4px 10px; border-radius:4px; border: 1px solid var(--neutral-200);">${filledCount} of ${totalCount} Filled</span>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Facility Name</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Date of Edit</th>
              </tr>
            </thead>
            <tbody>
              ${facilitiesRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  filterBlocks();
}

function filterBlocks() {
  const queryInput = document.getElementById('block-search-input');
  if(!queryInput) return;
  const query = queryInput.value.trim().toLowerCase();
  const cards = document.querySelectorAll('.block-status-card');
  cards.forEach(card => {
    const blockName = card.getAttribute('data-block-name') || '';
    if (blockName.includes(query)) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

// ========== ADMIN TABS PANEL SWITCHING ==========
function adminTabSwitch(id){
  if(!SESSION.isSuperAdmin && id !== 'at-desk') {
    toast("Access Denied: Sub-admins are restricted to Metadata Baseline edits.", "error");
    return;
  }
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.remove('active'));
  const content=document.getElementById(id);
  if(content) content.classList.add('active');
  const tabMap={'at-desk':0,'at-checklist':1,'at-orders':2,'at-admins':3};
  const tabs=document.querySelectorAll('.admin-tab');
  const idx=tabMap[id];
  if(idx!==undefined&&tabs[idx])tabs[idx].classList.add('active');
}

// ========== EPHEMERAL DRAFT & RECOVERY ENGINE (Public Computer Mitigation) ==========
function getS2Key(){
  return 'nqas_s2_'+SESSION.facilityName+'_'+SESSION.name;
}
function saveSection2(){
  if(!SESSION.facilityName) return;
  const asrs=[];
  document.querySelectorAll('.assessor-row').forEach(row=>{
    asrs.push({
      name:row.querySelector('.asr-name').value,
      phone:row.querySelector('.asr-phone').value
    });
  });
  const data={
    date:document.getElementById('assess-date').value,
    assessors:asrs,
    savedAt:new Date().toLocaleString('en-IN')
  };
  try{sessionStorage.setItem(getS2Key(),JSON.stringify(data));}catch(e){}
}
function restoreSection2(){
  if(!SESSION.facilityName||SESSION.isAdmin) return;
  try{
    const raw=sessionStorage.getItem(getS2Key());
    if(!raw)return;
    const d=JSON.parse(raw);
    if(d.date) document.getElementById('assess-date').value=d.date;
    if(d.assessors&&d.assessors.length){
      const list=document.getElementById('assessor-list');
      const existingRows=list.querySelectorAll('.assessor-row');
      d.assessors.forEach((a,i)=>{
        if(existingRows[i]){
          existingRows[i].querySelector('.asr-name').value=a.name||'';
          existingRows[i].querySelector('.asr-phone').value=a.phone||'';
        } else if(a.name){
          addAssessor();
          const rows=list.querySelectorAll('.assessor-row');
          const lastRow=rows[rows.length-1];
          lastRow.querySelector('.asr-name').value=a.name||'';
          lastRow.querySelector('.asr-phone').value=a.phone||'';
        }
      });
    }
    showDraftBanner(d.savedAt);
  }catch(e){}
}
function showDraftBanner(savedAt){
  let banner=document.getElementById('draft-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='draft-banner';
    banner.style.cssText='background-color:var(--accent-pale);border:1px solid var(--accent-border);border-left:4px solid var(--accent-gold);border-radius:var(--radius-lg);padding:12px 16px;font-size:0.82rem;color:#7c2d12;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:500;';
    const sec2=document.getElementById('sec-s2');
    if(sec2) sec2.insertBefore(banner,sec2.querySelector('.card'));
  }
  banner.innerHTML=`<span>📝 Draft restored — Saved: ${escapeHTML(savedAt)}</span>
    <button style="background:transparent;border:none;color:#7c2d12;cursor:pointer;font-size:1rem;font-weight:bold;padding:2px 6px;" onclick="clearDraft()">✕</button>`;
}
function clearDraft(){
  try{sessionStorage.removeItem(getS2Key());}catch(e){}
  const b=document.getElementById('draft-banner');if(b)b.remove();
  document.getElementById('assess-date').value=new Date().toISOString().split('T')[0];
  const list=document.getElementById('assessor-list');
  const rows=list.querySelectorAll('.assessor-row');
  rows.forEach((r,i)=>{
    r.querySelector('.asr-name').value='';
    r.querySelector('.asr-phone').value='';
    if(i>1)r.remove();
  });
  assessorCount=2;
  toast('Draft cleared');
}

// ========== BROWSE ANY FACILITY PARAMETERS ==========
function abrPopBlocks(){
  const ft=document.getElementById('abr-ftype').value;
  const blk=document.getElementById('abr-block');
  const fac=document.getElementById('abr-fac');
  blk.innerHTML='<option value="">Block</option>';
  fac.innerHTML='<option value="">Facility</option>';
  blk.disabled=!ft;fac.disabled=true;
  if(!ft)return;
  const blocks=[...new Set(FACILITIES.filter(f=>f.type===ft).map(f=>f.block))].sort();
  blocks.forEach(b=>blk.innerHTML+=`<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`);
}
function abrPopFacs(){
  const ft=document.getElementById('abr-ftype').value;
  const blk=document.getElementById('abr-block').value;
  const fac=document.getElementById('abr-fac');
  fac.innerHTML='<option value="">Facility</option>';
  fac.disabled=!blk;
  if(!blk)return;
  FACILITIES.filter(f=>f.type===ft&&f.block===blk).sort((a,b)=>a.name.localeCompare(b.name))
    .forEach(f=>fac.innerHTML+=`<option value="${escapeHTML(f.name)}">${escapeHTML(f.name)}</option>`);
}
function abrLoad(){
  const ft=document.getElementById('abr-ftype').value;
  const blk=document.getElementById('abr-block').value;
  const fac=document.getElementById('abr-fac').value;
  if(!fac){toast('⚠ Select a facility first','error');return;}
  SESSION.facilityType=ft;SESSION.blockName=blk;SESSION.facilityName=fac;
  loadDeskView();
  toast('Viewing: '+fac);
}

// ========== LOGOUT ==========
function doLogout(){
  SESSION={role:null,name:'',password:'',phone:'',facilityType:'',blockName:'',facilityName:'',isAdmin:false,isSuperAdmin:false,clientId:SESSION.clientId};
  assessorCount=2;
  selectedOrder=null;
  submissionPromise=null;
  ['a-name','a-phone','adm-user','adm-pass','sel-ftype'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  
  const s5Form = document.getElementById('s5-form-content');
  if(s5Form) s5Form.style.display = 'block';
  const successScreen = document.getElementById('success-screen');
  if(successScreen) successScreen.style.display = 'none';
  const btn = document.getElementById('btn-submit');
  if(btn){btn.disabled=false;btn.textContent='Submit All Details';}
  const nb=document.querySelector('#sec-s5 .nav-btns');if(nb)nb.style.display='flex';
  
  ['report','honor','state-order','dist-order'].forEach(t=>{
    const fp=document.getElementById('fp-'+t);if(fp)fp.style.display='none';
    const uz=document.getElementById('uz-'+t);if(uz)uz.style.borderColor='';
    const fi=document.getElementById('file-'+t);if(fi)fi.value='';
  });
  
  const uploadCard = document.getElementById('assessor-order-upload-card');
  if(uploadCard) uploadCard.style.display = 'none';

  const browser=document.getElementById('admin-facility-browser');
  if(browser) browser.style.display='none';

  ['ed-sheet', 'adm-sheet'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  ['ed-sheet-preview', 'adm-sheet-preview'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = 'none';
  });

  const blockSearch = document.getElementById('block-search-input');
  if(blockSearch) blockSearch.value = '';

  fileStore = {
    report: { data: null, name: "", mime: "" },
    honor: { data: null, name: "", mime: "" },
    stateOrder: { data: null, name: "", mime: "" },
    distOrder: { data: null, name: "", mime: "" },
    edSheet: { data: null, name: "", mime: "" },
    admSheet: { data: null, name: "", mime: "" }
  };

  const list = document.getElementById('assessor-list');
  if (list) {
    list.innerHTML = `
      <div class="assessor-row" data-idx="0">
        <div class="fg">
          <label>Primary Evaluator (Assessor 1) Full Name</label>
          <input type="text" class="asr-name" placeholder="1st Assessor name"/>
        </div>
        <div></div>
        <div class="fg">
          <label>Contact Number</label>
          <div class="phone-row">
            <div class="phone-prefix">+91</div>
            <input type="tel" class="asr-phone" placeholder="10-digit" maxlength="10"/>
          </div>
        </div>
        <div></div>
      </div>
      <div class="assessor-row" data-idx="1">
        <div class="fg">
          <label>Co-Evaluator (Assessor 2) Full Name</label>
          <input type="text" class="asr-name" placeholder="2nd Assessor name"/>
        </div>
        <div></div>
        <div class="fg">
          <label>Contact Number</label>
          <div class="phone-row">
            <div class="phone-prefix">+91</div>
            <input type="tel" class="asr-phone" placeholder="10-digit" maxlength="10"/>
          </div>
        </div>
        <div></div>
      </div>
    `;
  }
  assessorCount = 2;

  const sandboxBanner = document.getElementById('admin-sandbox-banner');
  if (sandboxBanner) sandboxBanner.style.display = 'none';

  goSec('s1');
  showScreen('s-welcome');
  window.scrollTo({top:0,behavior:'smooth'});
}

// ========== INITIALIZATION AND EVENT BINDING ==========
document.addEventListener('DOMContentLoaded', () => {
  // Generate transient transaction identifier for backend Anti-DoS quota tracking
  if (!sessionStorage.getItem('client_id')) {
    sessionStorage.setItem('client_id', 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
  }
  SESSION.clientId = sessionStorage.getItem('client_id');

  initPortal();

  // Input event mappings
  document.getElementById('a-phone').addEventListener('keydown', e => { if (e.key === 'Enter') assessorNext(); });
  document.getElementById('adm-pass').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  document.addEventListener('input', e => { if (e.target.closest('#sec-s2')) saveSection2(); });

  // Numeric telephone constraints
  document.querySelectorAll('input[type=tel]').forEach(el => {
    el.addEventListener('input', function() { this.value = this.value.replace(/\D/g, ''); });
  });

  // Drag and Drop implementation
  ['uz-report', 'uz-honor', 'uz-state-order', 'uz-dist-order'].forEach(id => {
    const uz = document.getElementById(id);
    if (!uz) return;
    uz.addEventListener('dragover', e => { e.preventDefault(); uz.classList.add('drag-over'); });
    uz.addEventListener('dragleave', () => uz.classList.remove('drag-over'));
    uz.addEventListener('drop', e => {
      e.preventDefault();
      uz.classList.remove('drag-over');
      const type = id.replace('uz-', '');
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleUpload(type, files[0]); // Pass file object directly avoiding restricted input assignments
      }
    });
  });

  // Admin Browser conditional visibility
  const _origLaunch = launchPortal;
  launchPortal = function() {
    _origLaunch();
    const browser = document.getElementById('admin-facility-browser');
    if (browser) {
      browser.style.display = SESSION.isAdmin ? 'block' : 'none';
    }
  };

  console.log('NQAS Portal v2.3 — Highly Secure Production Core loaded ✓');
});