const endpoint = '/api/openai.php';

// UI refs
const sentenceEl = document.getElementById('sentence');
const choicesEl = document.getElementById('choices');
const newBtn = document.getElementById('newBtn');
const skipBtn = document.getElementById('skipBtn');
const revealBtn = document.getElementById('revealBtn');
const toastEl = document.getElementById('toast');
const streakEl = document.getElementById('streak');
const bestEl = document.getElementById('best');
const difficultyEl = document.getElementById('difficulty');
const resultBanner = document.getElementById('resultBanner');
const selfStudyToggle = document.getElementById('selfStudy');

let current = null; // {word,sentence,choices,answer_index,explanation}
let isLocked = false;

// Storage keys
const KEY_HISTORY = 'sat_correct_words_log';
const KEY_STREAK = 'sat_streak';
const KEY_BEST = 'sat_best_streak';

function getHistory(){
  try{return JSON.parse(localStorage.getItem(KEY_HISTORY) || '[]')}
  catch(e){return []}
}
function saveHistory(arr){ localStorage.setItem(KEY_HISTORY, JSON.stringify(arr)); /* intentionally don't render history in UI (internal only) */ }
function addToHistory(word){ const h = getHistory(); h.push(word); saveHistory(h); }

function getStreak(){ return Number(localStorage.getItem(KEY_STREAK) || 0); }
function setStreak(n){ localStorage.setItem(KEY_STREAK, String(n)); streakEl.textContent = String(n); }
function getBest(){ return Number(localStorage.getItem(KEY_BEST) || 0); }
function setBest(n){ localStorage.setItem(KEY_BEST, String(n)); bestEl.textContent = String(n); }

function renderHistory(){ /* no-op: history is stored but not shown per settings */ }

function showToast(msg, timeout=2500){ toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(showToast._t); showToast._t = setTimeout(()=>toastEl.classList.remove('show'), timeout); }

function setLoading(state){ isLocked = state; newBtn.disabled = state; skipBtn.disabled = state; revealBtn.disabled = state; if(state) sentenceEl.textContent='Loading question…'; }

async function fetchQuestion(){
  setLoading(true);
  difficultyEl.textContent='—';
  // Build prompt
  const history = getHistory();
  const avoidList = (history.length>0 && history.length < 35) ? history.slice(-35) : [];

  const prompt = `You are a helpful question writer. Produce exactly one JSON object only, nothing else, with the following keys: word (string), sentence (a single sentence that uses the word in natural context; bold the word using ** around it), choices (an array of 4 short definitions as strings), answer_index (0-3 integer index into choices), difficulty ("SAT-hard"), explanation (short explanation string). The target word should be a challenging SAT-level vocabulary word (rarely used in everyday speech). Do not reveal which choice is correct in the sentence. The choices should be plausible distractors. Do not use punctuation that will prevent JSON parsing. Keep values short. Remember, the question should work in a normal context, but should provide very minimal yet helpful advice guiding the reader towards which the correct answer should be. This should be an SAT level question! Make it hard.
Avoid reusing these words: ${avoidList.join(', ')}
Return JSON only. Example format: {"word":"abstruse","sentence":"The professor's lecture was so **abstruse** that students struggled.","choices":["difficult to understand","pleasant","tiny","obvious"],"answer_index":0,"difficulty":"SAT-hard","explanation":"Abstruse = difficult to understand."}
`;

  try{
    const res = await fetch(endpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
    const txt = await res.text();
    // try to extract JSON object from response
    const jsonText = extractJson(txt);
    if(!jsonText) throw new Error('Could not parse model response as JSON');
    const obj = JSON.parse(jsonText);
    normalizeAndRender(obj);
  }catch(err){
    console.error(err);
    showToast('Couldn\'t load question. Try again.');
    sentenceEl.textContent = 'Error loading question. Please try again.';
  }finally{ setLoading(false); }
}

function extractJson(txt){
  // Find first { ... } block - naive but practical
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if(start===-1||end===-1||end<=start) return null;
  const j = txt.slice(start, end+1);
  // replace bold markdown in sentence if present
  return j.replace(/\*\*/g,'\\u002A\\u002A');
}

function normalizeAndRender(obj){
  // ensure structure
  if(!obj.word || !obj.sentence || !Array.isArray(obj.choices) || typeof obj.answer_index !== 'number'){
    throw new Error('Invalid question format');
  }
  // Unescape any escaped bold markers
  obj.sentence = obj.sentence.replace(/\\u002A\\u002A/g,'**');
  current = obj;
  renderQuestion();
}

function renderQuestion(){
  choicesEl.innerHTML='';
  const s = current.sentence.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  sentenceEl.innerHTML = s;
  difficultyEl.textContent = current.difficulty || 'SAT-hard';
  current.choices.forEach((c,i)=>{
    const b = document.createElement('button');
    b.className = 'choice';
    b.setAttribute('data-choice', String(i));
    b.innerHTML = `<span>${String.fromCharCode(65+i)}.</span>&nbsp; ${c}`;
    b.onclick = ()=>selectChoice(i,b);
    choicesEl.appendChild(b);
  });
}

function selectChoice(i, btn){
  if(isLocked || !current) return;
  isLocked = true;
  // disable buttons
  Array.from(choicesEl.children).forEach(ch=>ch.style.pointerEvents='none');
  const correct = (i === current.answer_index);
  if(correct){
    btn.classList.add('correct');
    const newStreak = getStreak()+1; setStreak(newStreak); if(newStreak>getBest()){ setBest(newStreak); }
    addToHistory(current.word);
    showResultBanner(true, 'Correct!');
    showToast('Correct!');
  } else {
    btn.classList.add('wrong');
    // highlight correct
    const correctBtn = choicesEl.querySelector('[data-choice="'+current.answer_index+'"]');
    if(correctBtn) correctBtn.classList.add('correct');
    setStreak(0);
    const ansLetter = String.fromCharCode(65+current.answer_index);
    showResultBanner(false, `Wrong — ${ansLetter}. ${current.choices[current.answer_index]}`);
    showToast('Wrong — keep trying!');
  }
  // show explanation inside banner
  if(current.explanation && resultBanner){
    const expl = document.createElement('div'); expl.style.marginTop='6px'; expl.style.color='var(--muted)'; expl.style.fontSize='13px'; expl.textContent = current.explanation;
    resultBanner.appendChild(expl);
  }
  // after a short delay, hide banner and optionally auto-fetch next
  setTimeout(()=>{
    hideResultBanner();
    Array.from(choicesEl.children).forEach(ch=>{ ch.classList.remove('correct','wrong'); ch.style.pointerEvents='auto'; });
    isLocked = false;
    if(selfStudyToggle && selfStudyToggle.checked){ fetchQuestion(); }
  }, 1400);
}

function showResultBanner(isCorrect, text){
  if(!resultBanner) return;
  resultBanner.hidden = false;
  resultBanner.classList.remove('correct','wrong');
  resultBanner.classList.add(isCorrect? 'correct':'wrong');
  resultBanner.innerHTML = '';
  const t = document.createElement('div'); t.textContent = text; resultBanner.appendChild(t);
}
function hideResultBanner(){ if(!resultBanner) return; resultBanner.hidden = true; resultBanner.innerHTML = ''; resultBanner.classList.remove('correct','wrong'); }

// keyboard A-D support
window.addEventListener('keydown', (e)=>{
  if(!current || isLocked) return;
  const k = e.key.toLowerCase();
  if(['a','b','c','d'].includes(k)){
    const idx = ['a','b','c','d'].indexOf(k);
    const btn = choicesEl.querySelector('[data-choice="'+idx+'"]');
    if(btn) btn.click();
  }
});

function revealAnswer(){
  if(!current) return; const btn = choicesEl.children[current.answer_index]; if(btn) btn.classList.add('correct'); setStreak(0); showToast('Answer revealed');
}

newBtn.addEventListener('click', fetchQuestion);
skipBtn.addEventListener('click', ()=>{ if(confirm('Skip this question? Streak will reset.')){ setStreak(0); fetchQuestion(); }});
revealBtn.addEventListener('click', revealAnswer);

// init
setStreak(getStreak()); setBest(getBest()); renderHistory();

// quick sanity: preload a question on first load
window.addEventListener('load', ()=>{ if(!getHistory().length && getStreak()===0){ /* show hint, not auto-fire */ } });

// expose for debugging
window.__sat = { fetchQuestion, getHistory, normalizeAndRender };
