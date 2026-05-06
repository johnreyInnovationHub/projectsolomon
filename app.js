/* ══════════════════════════════════════════════
   PROJECT SOLOMON · app.js  v3
   Supabase = PRIMARY database
   localStorage  = session + short-term cache only
══════════════════════════════════════════════ */

/* ══ SUPABASE CONFIG — paste your values here ══ */
const SUPABASE_URL = 'https://wgbnlplbxiprslakzvft.supabase.co/rest/v1/';       // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_HEei_Dxczd9KxzJxbXpNAg_lsf3MasW'; // from Settings → API → anon public
/* ═════════════════════════════════════════════ */

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── OOO BACKGROUND INIT ─── */
function initStarfield() {
  const sf = document.getElementById('ooo-bg') || document.getElementById('starfield');
  if (!sf) return;
  for (let i = 0; i < 180; i++) {
    const s = document.createElement('div'); s.className = 'ooo-star';
    const sz = Math.random()*2.5+0.5;
    s.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random()*100}%;top:${Math.random()*100}%;animation-duration:${Math.random()*4+2}s;animation-delay:${Math.random()*5}s;opacity:${Math.random()*0.6+0.1};`;
    sf.appendChild(s);
  }
  ['rgba(74,14,143,1)','rgba(0,170,255,1)','rgba(255,105,180,1)','rgba(0,212,170,1)'].forEach(c => {
    const b = document.createElement('div'); b.className = 'ooo-blob';
    const sz = Math.random()*300+200;
    b.style.cssText = `width:${sz}px;height:${sz}px;background:${c};left:${Math.random()*100}%;top:${Math.random()*100}%;`;
    document.body.appendChild(b);
  });
}

/* ─── TOAST ─── */
let _toastTimer;
function showToast(msg, type='info') {
  let t = document.getElementById('global-toast');
  if (!t) { t = document.createElement('div'); t.id='global-toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(_toastTimer); _toastTimer = setTimeout(()=>t.classList.remove('show'), 3500);
}

/* ─── SESSION ─── */
const SESSION_KEY = 'solomon_session';
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)||'null'); } catch { return null; } }
function setSession(data) { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

/* ── PERMANENT TEACHER PASSWORD ── */
(function() {
  localStorage.removeItem('solomon_teacher_pw');
  localStorage.setItem('solomon_teacher_pw', 'solomonwisdom');
})();

/* ══════════════════════════════════════════════
   STUDENT CACHE (per email, 30-min TTL)
══════════════════════════════════════════════ */
function cacheStudent(student) {
  if (!student || !student.email) return;
  localStorage.setItem(`s_stu_${student.email.toLowerCase()}`, JSON.stringify({...student, _cachedAt:Date.now()}));
}
function getCachedStudent(email) {
  try {
    const raw = localStorage.getItem(`s_stu_${email.toLowerCase()}`);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s._cachedAt > 30*60*1000) return null;
    return s;
  } catch { return null; }
}
function bustStudentCache(email) { localStorage.removeItem(`s_stu_${email.toLowerCase()}`); }

/* ══════════════════════════════════════════════
   STUDENTS
══════════════════════════════════════════════ */

/** Register a new student */
async function saveStudent(student) {
  const payload = {
    email: student.email.toLowerCase().trim(),
    name: student.name || '',
    section: student.section || '',
    avatar: student.avatar || '',
    status: 'pending',
    xp: 0,
    loot_bags: 0,
    created_at: new Date().toISOString()
  };
  // Check for duplicate
  const { data: existing } = await db.from('students').select('email').eq('email', payload.email).single();
  if (existing) return { ok: false, error: 'duplicate' };
  const { error } = await db.from('students').insert(payload);
  if (error) return { ok: false, error: error.message };
  cacheStudent({ ...payload, lootBags: 0 });
  return { ok: true };
}

/** Fetch student by email */
async function fetchStudent(email) {
  const { data, error } = await db.from('students').select('*').eq('email', email.toLowerCase()).single();
  if (error || !data) return getCachedStudent(email);
  // Map DB field loot_bags → lootBags for legacy compatibility
  const student = { ...data, lootBags: data.loot_bags };
  cacheStudent(student);
  return student;
}

/** Teacher: get all students */
async function getStudents() {
  const { data, error } = await db.from('students').select('*').order('name');
  if (error || !data) return [];
  return data.map(s => ({ ...s, lootBags: s.loot_bags }));
}

/** Update student XP, lootBags, status, avatar */
async function updateStudent(email, updates) {
  // Remap lootBags → loot_bags for DB
  const dbUpdates = { ...updates };
  if (dbUpdates.lootBags !== undefined) { dbUpdates.loot_bags = dbUpdates.lootBags; delete dbUpdates.lootBags; }
  const { error } = await db.from('students').update(dbUpdates).eq('email', email.toLowerCase());
  if (error) console.error('updateStudent error:', error.message);
  // Optimistic cache update
  const cached = getCachedStudent(email);
  if (cached) cacheStudent({ ...cached, ...updates });
}

/* ══════════════════════════════════════════════
   QUIZZES
══════════════════════════════════════════════ */

/** Teacher: get all quizzes (including locked) */
async function getQuizzes() {
  const { data: quizzes, error } = await db.from('quizzes').select('*, quiz_questions(questions)').order('created_at', { ascending: false });
  if (error || !quizzes) return getLocalData('quizzes'); // fallback to local
  return quizzes.map(q => parseDbQuiz(q));
}

/** Students: get unlocked quizzes filtered by section */
async function fetchQuizzesForStudent(section) {
  let query = db.from('quizzes').select('*, quiz_questions(questions)').eq('locked', false);
  const { data, error } = await query;
  if (error || !data) return getLocalData('quizzes').filter(q => !q.locked);
  let quizzes = data.map(q => parseDbQuiz(q));
  if (section) {
    quizzes = quizzes.filter(q => {
      const secs = Array.isArray(q.sections) ? q.sections : [];
      return secs.length === 0 || secs.includes(section);
    });
  }
  return quizzes;
}

/** Fetch a single quiz by ID */
async function fetchQuizById(id) {
  // Check local first (teacher preview)
  const local = getLocalData('quizzes').find(q => q.id == id);
  if (local && local.questions && local.questions.length > 0) return local;
  // Fetch from Supabase
  const { data, error } = await db.from('quizzes').select('*, quiz_questions(questions)').eq('id', String(id)).single();
  if (error || !data) return null;
  return parseDbQuiz(data);
}

/** Parse DB quiz row → app format */
function parseDbQuiz(q) {
  let questions = [];
  const qData = q.quiz_questions;
  const rawQ = Array.isArray(qData) ? qData[0]?.questions : qData?.questions;
  if (rawQ) {
    try { questions = JSON.parse(rawQ); } catch { questions = []; }
  }
  if (!Array.isArray(questions)) questions = [];
  questions = questions.map(qObj => ({
    ...qObj,
    correct: parseInt(qObj.correct) || 0,
    options: Array.isArray(qObj.options) ? qObj.options : []
  }));
  let sections = [];
  if (Array.isArray(q.sections)) sections = q.sections;
  else if (typeof q.sections === 'string') sections = q.sections.split(',').map(s => s.trim()).filter(Boolean);
  return {
    id: q.id,
    title: q.title || '',
    subject: q.subject || '',
    time: parseInt(q.time) || 15,
    sections,
    locked: q.locked === true,
    category: q.category || 'practice',
    questions,
    createdAt: q.created_at || ''
  };
}

/** Teacher: save new quiz */
async function saveQuiz(quiz) {
  const id = String(quiz.id || Date.now());
  const questionsJson = JSON.stringify(quiz.questions || []);
  const sections = Array.isArray(quiz.sections) ? quiz.sections.join(',') : (quiz.sections || '');

  // Insert into quizzes table
  const { error: qErr } = await db.from('quizzes').insert({
    id,
    title: quiz.title || '',
    subject: quiz.subject || '',
    time: parseInt(quiz.time) || 15,
    sections,
    locked: false,
    category: quiz.category || 'practice',
    created_at: quiz.createdAt || new Date().toISOString()
  });
  if (qErr) { console.error('saveQuiz error:', qErr.message); return null; }

  // Insert questions into quiz_questions table
  await db.from('quiz_questions').insert({ quiz_id: id, questions: questionsJson });

  // Also save locally for instant teacher preview
  const record = { ...quiz, id, createdAt: quiz.createdAt || new Date().toISOString() };
  const local = getLocalData('quizzes');
  local.unshift(record);
  setLocalData('quizzes', local);
  return record;
}

/** Teacher: update quiz (locked, category, etc.) */
async function updateQuiz(id, updates) {
  const dbUpdates = { ...updates };
  const { error } = await db.from('quizzes').update(dbUpdates).eq('id', String(id));
  if (error) console.error('updateQuiz error:', error.message);
  // Local update too
  const quizzes = getLocalData('quizzes');
  const idx = quizzes.findIndex(q => q.id == id);
  if (idx >= 0) { quizzes[idx] = { ...quizzes[idx], ...updates }; setLocalData('quizzes', quizzes); }
}

function getQuiz(id) { return getLocalData('quizzes').find(q => q.id == id) || null; }

/* ══════════════════════════════════════════════
   SCORES
══════════════════════════════════════════════ */

async function saveScore(entry) {
  const score = Number(entry.score) || 0;
  const total = Number(entry.total) || 1;
  const percent = Math.round((score / total) * 100);
  const xp = Math.round((score / total) * 50);

  const { error } = await db.from('scores').insert({
    email: entry.email.toLowerCase(),
    name: entry.name || '',
    section: (entry.section || '').trim(),
    quiz_id: String(entry.quizId || ''),
    quiz_title: entry.quizTitle || '',
    category: entry.category || 'practice',
    score,
    total,
    percent,
    xp,
    tab_switches: Number(entry.tabSwitches) || 0,
    time_taken: entry.timeTaken || '',
    created_at: entry.createdAt || new Date().toISOString()
  });
  if (error) { console.error('saveScore error:', error.message); return; }

  // Update student XP and loot bags
  const student = getCachedStudent(entry.email);
  if (student) {
    const newXP = (parseInt(student.xp) || 0) + xp;
    const newLoot = score === total ? (parseInt(student.lootBags) || 0) + 1 : (parseInt(student.lootBags) || 0);
    await updateStudent(entry.email, { xp: newXP, lootBags: newLoot });
  }
}

async function getScores() {
  const { data, error } = await db.from('scores').select('*').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(s => ({
    email: s.email, name: s.name, section: s.section,
    quizId: s.quiz_id, quizTitle: s.quiz_title, category: s.category,
    score: s.score, total: s.total, percent: s.percent, xp: s.xp,
    tabSwitches: s.tab_switches, timeTaken: s.time_taken, createdAt: s.created_at
  }));
}

async function getStudentScores(email) {
  const { data, error } = await db.from('scores').select('*').eq('email', email.toLowerCase()).order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(s => ({
    email: s.email, name: s.name, section: s.section,
    quizId: s.quiz_id, quizTitle: s.quiz_title, category: s.category,
    score: s.score, total: s.total, percent: s.percent, xp: s.xp,
    tabSwitches: s.tab_switches, timeTaken: s.time_taken, createdAt: s.created_at
  }));
}

/* ══════════════════════════════════════════════
   LESSON DATA
══════════════════════════════════════════════ */

async function saveLesson(quizId, lessonData) {
  const { error } = await db.from('lesson_data').upsert({
    quiz_id: String(quizId),
    lesson_content: typeof lessonData === 'string' ? lessonData : JSON.stringify(lessonData),
    saved_at: new Date().toISOString()
  }, { onConflict: 'quiz_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function getLesson(quizId) {
  const { data, error } = await db.from('lesson_data').select('lesson_content').eq('quiz_id', String(quizId)).single();
  if (error || !data) return { ok: false, error: 'not_found' };
  return { ok: true, lessonData: data.lesson_content };
}

/* ─── LOCAL DATA HELPERS (for quiz builder local-first cache) ─── */
function getLocalData(key) { try { return JSON.parse(localStorage.getItem(`s_${key}`) || '[]'); } catch { return []; } }
function setLocalData(key, data) { localStorage.setItem(`s_${key}`, JSON.stringify(data)); }

/* ─── QUIZ PARSER ─── */
function parseQuizHTML(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const questions = [];
  doc.querySelectorAll('ol > li, .question, [class*="question"]').forEach(qEl => {
    const qText = qEl.querySelector('p,.question-text')?.textContent.trim() || qEl.firstChild?.textContent.trim() || '';
    if (!qText) return;
    const opts = []; let correct = 0;
    qEl.querySelectorAll('li,.option,input[type="radio"]+label').forEach((opt, oi) => {
      const txt = opt.textContent.trim().replace(/^[A-Da-d][.)]\s*/, '');
      if (!txt || txt === qText) return;
      opts.push(txt);
      if (opt.dataset.correct === 'true' || opt.classList.contains('correct')) correct = oi;
    });
    if (opts.length >= 2) questions.push({ question: qText, options: opts, correct });
  });
  if (questions.length === 0) {
    const lines = (doc.body.innerText || doc.body.textContent || '').split('\n').map(l => l.trim()).filter(Boolean);
    let cur = null;
    lines.forEach(line => {
      if (/^\d+[.)]\s/.test(line)) { if (cur && cur.options.length >= 2) questions.push(cur); cur = { question: line.replace(/^\d+[.)]\s*/, ''), options: [], correct: 0 }; }
      else if (cur && /^[A-Da-d][.)]\s/.test(line)) { const ok = line.includes('*') || line.includes('✓'); const txt = line.replace(/^[A-Da-d][.)]\s*/, '').replace(/[*✓]/g, '').trim(); if (ok) cur.correct = cur.options.length; cur.options.push(txt); }
    });
    if (cur && cur.options.length >= 2) questions.push(cur);
  }
  return questions;
}

/* ─── AVATARS ─── */
const AVATARS = [
  {id:'finn',emoji:'⚔️',label:'Finn',universe:'Ooo Heroes'},
  {id:'jake',emoji:'🐶',label:'Jake',universe:'Ooo Heroes'},
  {id:'bmo',emoji:'🎮',label:'BMO',universe:'Ooo Heroes'},
  {id:'pb',emoji:'🍬',label:'PB',universe:'Ooo Heroes'},
  {id:'marceline',emoji:'🎸',label:'Marceline',universe:'Ooo Heroes'},
  {id:'iceking',emoji:'❄️',label:'Ice King',universe:'Ooo Heroes'},
  {id:'flame',emoji:'🔥',label:'Flame Princess',universe:'Ooo Heroes'},
  {id:'tree',emoji:'🌳',label:'Tree Trunks',universe:'Ooo Heroes'},
  {id:'gunter',emoji:'🐧',label:'Gunter',universe:'Ooo Heroes'},
  {id:'pika',emoji:'⚡',label:'Zappix',universe:'Pokéverse'},
  {id:'bulb',emoji:'🌿',label:'Leaflet',universe:'Pokéverse'},
  {id:'char',emoji:'🔥',label:'Pyron',universe:'Pokéverse'},
  {id:'squi',emoji:'💧',label:'Aquor',universe:'Pokéverse'},
  {id:'mew',emoji:'🌟',label:'Mystix',universe:'Pokéverse'},
  {id:'el',emoji:'🔮',label:'Psionica',universe:'Upside Down'},
  {id:'will',emoji:'🎮',label:'Gamewarden',universe:'Upside Down'},
  {id:'demo',emoji:'🌑',label:'Shadewing',universe:'Upside Down'},
  {id:'max',emoji:'🎧',label:'Beatrix',universe:'Upside Down'},
  {id:'hop',emoji:'🛡️',label:'Ironkeep',universe:'Upside Down'},
  {id:'hp',emoji:'⚡',label:'Thundermark',universe:'Wizardlands'},
  {id:'herm',emoji:'📚',label:'Scholara',universe:'Wizardlands'},
  {id:'ron',emoji:'♟️',label:'Strategos',universe:'Wizardlands'},
  {id:'luna',emoji:'🌙',label:'Lunara',universe:'Wizardlands'},
  {id:'nev',emoji:'🌱',label:'Bloomcaster',universe:'Wizardlands'},
  {id:'nar',emoji:'🍜',label:'Rasenwave',universe:'Shinobi Realm'},
  {id:'sas',emoji:'⚡',label:'Sharinkai',universe:'Shinobi Realm'},
  {id:'sak',emoji:'💪',label:'Forceblossom',universe:'Shinobi Realm'},
  {id:'kak',emoji:'👁️',label:'Veilmaster',universe:'Shinobi Realm'},
  {id:'rock',emoji:'🥊',label:'Hardstone',universe:'Shinobi Realm'},
  {id:'anya',emoji:'🧠',label:'Mindreader',universe:'Strix Division'},
  {id:'loid',emoji:'🎭',label:'Phantom',universe:'Strix Division'},
  {id:'yor',emoji:'🌸',label:'Thornrose',universe:'Strix Division'},
  {id:'bond',emoji:'🐾',label:'Futures',universe:'Strix Division'},
  {id:'frank',emoji:'🔍',label:'Watcher',universe:'Strix Division'},
];
function getAvatarById(id) { return AVATARS.find(a => a.id === id) || AVATARS[0]; }

/* ─── XP ─── */
function getLevel(xp) {
  const lv = [
    {min:0,label:'Novice Hero',next:100},{min:100,label:'Grasslands Scout',next:250},
    {min:250,label:'Land of Ooo Explorer',next:500},{min:500,label:'Candy Kingdom Guard',next:1000},
    {min:1000,label:'Ooo Champion',next:2000},{min:2000,label:'Ancient Hero',next:4000},
    {min:4000,label:'Excellence is a Habit',next:Infinity}
  ];
  for (let i = lv.length-1; i >= 0; i--) {
    if (xp >= lv[i].min) return {...lv[i], xp, progress: i < lv.length-1 ? Math.min(100, ((xp-lv[i].min)/(lv[i].next-lv[i].min))*100) : 100};
  }
  return {...lv[0], xp, progress: 0};
}

/* ─── LOOT ─── */
const LOOT_REWARDS = [
  {id:'choco',emoji:'🍫',name:'Chocolate Bar',rarity:'Common'},{id:'pen',emoji:'✏️',name:'Cosmic Pen',rarity:'Common'},
  {id:'note',emoji:'📓',name:'Galaxy Notebook',rarity:'Uncommon'},{id:'sticker',emoji:'⭐',name:'Star Sticker Pack',rarity:'Common'},
  {id:'ruler',emoji:'📏',name:'Nebula Ruler',rarity:'Common'},{id:'medal',emoji:'🥇',name:'Gold Medal',rarity:'Rare'},
  {id:'eraser',emoji:'🧹',name:'Space Eraser',rarity:'Common'},{id:'clip',emoji:'📎',name:'Comet Clips Set',rarity:'Uncommon'},
];
function rollLoot() {
  const w = LOOT_REWARDS.map(r => r.rarity==='Rare'?1:r.rarity==='Uncommon'?3:6);
  const t = w.reduce((a,b) => a+b, 0); let r = Math.random()*t;
  for (let i = 0; i < LOOT_REWARDS.length; i++) { r -= w[i]; if (r <= 0) return LOOT_REWARDS[i]; }
  return LOOT_REWARDS[0];
}

/* ─── UTILS ─── */
function timeAgo(d) { const s=(Date.now()-new Date(d))/1000; if(s<60)return'just now'; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; }
function formatDate(d) { if(!d)return'N/A'; const dt=new Date(d); if(isNaN(dt.getTime()))return String(d).substring(0,10)||'N/A'; return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function showLoading(el, msg='Loading...') { if(typeof el==='string')el=document.getElementById(el); if(el)el.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--text-muted);"><div class="spinner"></div><p style="margin-top:1rem;font-size:0.85rem;">${msg}</p></div>`; }

document.addEventListener('DOMContentLoaded', initStarfield);
