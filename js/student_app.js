// Student App Logic

let allQuestions = [];
let currentTab = 'home';
let currentSession = {
    questions: [],
    currentIndex: 0,
    answers: {} // { questionId: { selected: 'A', isCorrect: true } }
};

const STORAGE_KEYS = {
    stats: 'chem_question_stats',
    attempts: 'chem_attempt_history'
};

let yearIndex = {};
let activeAttempt = null;

function getStoredStats() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.stats);
        if (raw) return JSON.parse(raw);
    } catch (err) {
        console.warn('Unable to parse stored stats', err);
    }
    return { questions: {}, topics: {}, years: {} };
}

function saveStoredStats(stats) {
    localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
}

function ensureStatsEntry(bucket, key, label) {
    if (!bucket[key]) {
        bucket[key] = { attempts: 0, correct: 0, incorrect: 0, label: label || key };
    } else if (label && !bucket[key].label) {
        bucket[key].label = label;
    }
    return bucket[key];
}

function normalizeTextKey(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80);
}

function getQuestionKey(q) {
    if (!q) return 'unknown-question';
    return q.id || q.uid || q.questionId || `${q.topicId || 'topic'}-${q.source || 'src'}-${q.year || 'year'}-${normalizeTextKey(q.question)}`;
}

function buildYearKey(q) {
    return `${q.source || 'Unknown'} ${q.year || 'N/A'}`.trim();
}

function recordQuestionAttempt(q, isCorrect) {
    if (!q) return;
    const stats = getStoredStats();
    const questionKey = getQuestionKey(q);
    const questionEntry = ensureStatsEntry(stats.questions, questionKey, q.question ? q.question.slice(0, 60) : questionKey);
    questionEntry.attempts += 1;
    if (isCorrect === true) questionEntry.correct += 1;
    if (isCorrect === false) questionEntry.incorrect += 1;

    const topicId = q.topicId || 'Unknown-Topic';
    const topicEntry = ensureStatsEntry(stats.topics, topicId, q.topicName || topicId);
    topicEntry.attempts += 1;
    if (isCorrect === true) topicEntry.correct += 1;
    if (isCorrect === false) topicEntry.incorrect += 1;

    const yearKey = buildYearKey(q);
    const yearEntry = ensureStatsEntry(stats.years, yearKey, yearKey);
    yearEntry.attempts += 1;
    if (isCorrect === true) yearEntry.correct += 1;
    if (isCorrect === false) yearEntry.incorrect += 1;

    saveStoredStats(stats);
}

function getQuestionStatsEntry(q) {
    const stats = getStoredStats();
    return stats.questions[getQuestionKey(q)] || { attempts: 0, correct: 0, incorrect: 0 };
}

function getTopicStats(topicId) {
    const stats = getStoredStats();
    return stats.topics[topicId] || { attempts: 0, correct: 0, incorrect: 0 };
}

function getYearStats(yearKey) {
    const stats = getStoredStats();
    return stats.years[yearKey] || { attempts: 0, correct: 0, incorrect: 0 };
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightWithKeywords(text, keywords = []) {
    if (!text) return '';
    let sanitized = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    keywords
        .filter(Boolean)
        .forEach(keyword => {
            const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
            sanitized = sanitized.replace(regex, '<span class="highlight">$1</span>');
        });

    return sanitized;
}

function getSafeDomId(prefix, key) {
    return `${prefix}-${key}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Hardcoded Repo Info
const REPO_CONFIG = {
    owner: 'Revampes',
    repo: 'ChemQuestion',
    url: 'https://github.com/Revampes/ChemQuestion'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    autoConnect();
});

// Tab Switching
window.switchTab = function(tabId) {
    currentTab = tabId;
    
    // Update Nav
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Update View
    document.querySelectorAll('.view-section').forEach(view => {
        view.style.display = 'none';
    });
    const el = document.getElementById(`${tabId}-view`);
    if (el) el.style.display = 'block';
    
    // Render sidebars if needed (data already loaded)
    if (allQuestions.length > 0) { if (tabId === 'by-year') renderYearSidebar(); if (tabId === 'by-topic') renderTopicSidebar(); }
};

async function autoConnect() {
    const loadingIndicator = document.getElementById('loading-indicator');
    
    try {
        // Fetch repo metadata to get default branch
        const metaResp = await fetch(`https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`);
        if (!metaResp.ok) {
            throw new Error('Repository not found or not public');
        }
        const meta = await metaResp.json();
        const branch = meta.default_branch || 'main';

        // Set global repoInfo
        repoInfo = { owner: REPO_CONFIG.owner, repo: REPO_CONFIG.repo, branch, token: null };
        
        // Load Data
        await loadAllQuestions();
        
        updateDashboardStats();

        if (loadingIndicator) loadingIndicator.style.display = 'none';
    } catch (err) {
        console.error(err);
        if (loadingIndicator) {
            loadingIndicator.textContent = 'Connection Failed: ' + err.message;
            loadingIndicator.style.color = '#f56565';
        }
    }
}

async function loadAllQuestions() {
    allQuestions = [];
    
    try {
        // TOPICS is from config.js
        for (const topic of TOPICS) {
            try {
                // Use raw.githubusercontent.com to avoid API rate limits for public repos
                const url = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/topics/${topic.file}`;
                const resp = await fetch(url);
                
                if (resp.ok) {
                    const content = await resp.json();
                    
                    if (content.questions && Array.isArray(content.questions)) {
                        // Add topic info to each question
                        const questionsWithTopic = content.questions.map(q => ({
                            ...q,
                            topicId: topic.id,
                            topicName: topic.name
                        }));
                        allQuestions.push(...questionsWithTopic);
                    }
                }
            } catch (e) {
                console.warn(`Error loading topic ${topic.name}:`, e);
            }
        }
        console.log(`Loaded ${allQuestions.length} questions.`);

        buildYearIndex();
        
        // Initial render sidebars
        renderYearSidebar();
        renderTopicSidebar();
        
    } catch (err) {
        console.error('Error loading questions:', err);
    }
}

function buildYearIndex() {
    yearIndex = {};
    allQuestions.forEach(q => {
        const key = buildYearKey(q);
        if (!yearIndex[key]) {
            yearIndex[key] = {
                key,
                source: q.source,
                year: q.year,
                parts: { '1A': [], '1B': [], '2': [] }
            };
        }
        const part = getPaperPart(q);
        yearIndex[key].parts[part].push(q);
    });
}

function getPaperPart(q) {
    if (!q) return '1A';
    if (q.paperPart) return q.paperPart;
    if ((q.type || '').toLowerCase() === 'multiple-choice') return '1A';
    const topicId = (q.topicId || '').toLowerCase();
    if (topicId.includes('elective')) return '2';
    if ((q.section || '').toLowerCase().includes('elective')) return '2';
    return '1B';
}

function resolveImageUrl(path) {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/${path}`;
}

// Convert question content (markdown images or inline <img>) to safe HTML
function processQuestionContent(raw) {
    if (!raw) return '';
    // If content was HTML-escaped (e.g. &lt;b&gt;), decode those entities first
    function decodeHtmlEntities(s) {
        return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }

    let html = decodeHtmlEntities(raw);

    // Convert markdown image syntax ![alt](path) -> <img src="...">
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, path) => {
        const src = resolveImageUrl(path.trim());
        const safeAlt = (alt || '').replace(/"/g, '&quot;');
        return `<img src="${src}" alt="${safeAlt}" style="max-width:100%; display:block; margin:10px 0;">`;
    });

    // Rewrite any inline <img src="..."> to use resolved raw.githubusercontent URL for relative paths
    html = html.replace(/<img\s+([^>]*?)src=(['"])(.*?)\2([^>]*?)>/gi, (match, preAttrs, q, src, postAttrs) => {
        const trimmed = src.trim();
        const resolved = resolveImageUrl(trimmed);
        return `<img ${preAttrs}src="${resolved}"${postAttrs}>`;
    });

    return html;
}

function updateDashboardStats() {
    const totalQuestions = allQuestions.length;
    const topicsCount = TOPICS.length;
    // Calculate unique years
    const years = new Set(allQuestions.map(q => q.year).filter(y => y));
    const yearsCount = years.size;

    const elTotal = document.getElementById('stat-total-questions');
    const elTopics = document.getElementById('stat-topics-count');
    const elYears = document.getElementById('stat-years-count');

    // Animate numbers
    if (elTotal) animateValue(elTotal, 0, totalQuestions, 1000);
    if (elTopics) animateValue(elTopics, 0, topicsCount, 1000);
    if (elYears) animateValue(elYears, 0, yearsCount, 1000);
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

window.startRandomPractice = function() {
    if (allQuestions.length === 0) {
        alert("Questions are still loading. Please wait...");
        return;
    }
    
    // Switch to practice view
    switchTab('practice');
    
    // Pick 10 random questions
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 10);
    
    startSession(selected, 'practice-content');
};

// --- Sidebar Rendering ---

function renderYearSidebar() {
    const sidebar = document.getElementById('year-sidebar');
    sidebar.innerHTML = '';

    const keys = Object.keys(yearIndex);
    if (keys.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'placeholder-text';
        emptyState.textContent = 'No yearly papers available yet.';
        sidebar.appendChild(emptyState);
        return;
    }

    const sortedKeys = keys.sort((a, b) => {
        const [sourceA = '', yearA = '0'] = a.split(' ');
        const [sourceB = '', yearB = '0'] = b.split(' ');
        const sourceOrder = { 'DSE': 0, 'AL': 1, 'CE': 2 };
        const orderA = sourceOrder[sourceA] !== undefined ? sourceOrder[sourceA] : 3;
        const orderB = sourceOrder[sourceB] !== undefined ? sourceOrder[sourceB] : 3;
        if (orderA !== orderB) return orderA - orderB;
        return (parseInt(yearA, 10) || 0) - (parseInt(yearB, 10) || 0);
    });

    sortedKeys.forEach((key, idx) => {
        const item = document.createElement('div');
        item.className = 'sidebar-item';
        item.textContent = key;
        item.onclick = () => {
            sidebar.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            renderYearLanding(key);
        };
        if (idx === 0) item.classList.add('active');
        sidebar.appendChild(item);
    });

    renderYearLanding(sortedKeys[0]);
}

function renderYearLanding(yearKey) {
    const container = document.getElementById('year-content');
    if (!container) return;
    const yearData = yearIndex[yearKey];
    if (!yearData) {
        container.innerHTML = '<div class="placeholder-text">No paper data found for this year.</div>';
        return;
    }

    const stats = getYearStats(yearKey);
    const counts = {
        '1A': yearData.parts['1A'].length,
        '1B': yearData.parts['1B'].length,
        '2': yearData.parts['2'].length
    };

    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'year-detail-panel';

    const header = document.createElement('div');
    header.className = 'year-detail-header';
    const headingBlock = document.createElement('div');
    headingBlock.innerHTML = `
        <p style="text-transform:uppercase; letter-spacing:0.3em; color:#a0aec0;">${yearData.source || 'Exam'}</p>
        <h3>${yearKey}</h3>
    `;

    const countGrid = document.createElement('div');
    countGrid.className = 'year-count-grid';
    ['1A', '1B', '2'].forEach(part => {
        const chip = document.createElement('div');
        chip.className = 'year-count-chip';
        chip.innerHTML = `<span>Paper ${part}</span><strong>${counts[part]}</strong>`;
        countGrid.appendChild(chip);
    });
    headingBlock.appendChild(countGrid);
    header.appendChild(headingBlock);

    const statsStack = document.createElement('div');
    statsStack.className = 'stats-stack';
    const statsMap = [
        { label: 'Attempts', value: stats.attempts },
        { label: 'Correct', value: stats.correct },
        { label: 'Incorrect', value: stats.incorrect }
    ];
    statsMap.forEach(item => {
        const card = document.createElement('div');
        card.className = 'stats-card';
        card.innerHTML = `<span style="font-size:0.8em; text-transform:uppercase; letter-spacing:0.2em; color:#a0aec0;">${item.label}</span><h4 style="font-size:2em; color:#fbd38d;">${item.value || 0}</h4>`;
        statsStack.appendChild(card);
    });
    header.appendChild(statsStack);
    panel.appendChild(header);

    const actionGrid = document.createElement('div');
    actionGrid.className = 'paper-action-grid';

    const previewCard = document.createElement('div');
    previewCard.className = 'paper-action';
    previewCard.innerHTML = '<h4>Preview Paper</h4><p>Quickly skim through every answer from MC to long questions before attempting.</p>';
    const previewBtn = document.createElement('button');
    previewBtn.className = 'btn';
    previewBtn.textContent = 'Preview';
    previewBtn.onclick = () => renderYearPreview(yearKey);
    previewBtn.disabled = counts['1A'] + counts['1B'] + counts['2'] === 0;
    previewCard.appendChild(previewBtn);
    actionGrid.appendChild(previewCard);

    const paper1Card = document.createElement('div');
    paper1Card.className = 'paper-action';
    paper1Card.innerHTML = '<h4>Attempt Paper 1</h4><p>Includes Paper 1A (MC) & 1B (structured). Full exam timer: 2 hrs 30 mins.</p>';
    const paper1Btn = document.createElement('button');
    paper1Btn.className = 'btn';
    paper1Btn.textContent = 'Start Paper 1';
    paper1Btn.onclick = () => startPaperAttempt(yearKey, 'paper1');
    paper1Btn.disabled = counts['1A'] + counts['1B'] === 0;
    paper1Card.appendChild(paper1Btn);
    actionGrid.appendChild(paper1Card);

    const paper2Card = document.createElement('div');
    paper2Card.className = 'paper-action';
    paper2Card.innerHTML = '<h4>Attempt Paper 2</h4><p>Elective-focused long questions. Timer: 1 hr.</p>';
    const paper2Btn = document.createElement('button');
    paper2Btn.className = 'btn';
    paper2Btn.textContent = 'Start Paper 2';
    paper2Btn.onclick = () => startPaperAttempt(yearKey, 'paper2');
    paper2Btn.disabled = counts['2'] === 0;
    paper2Card.appendChild(paper2Btn);
    actionGrid.appendChild(paper2Card);

    panel.appendChild(actionGrid);
    container.appendChild(panel);
}

function renderYearPreview(yearKey) {
    const container = document.getElementById('year-content');
    const yearData = yearIndex[yearKey];
    if (!container || !yearData) return;

    container.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'paper-toolbar';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.textContent = 'Back to Actions';
    backBtn.onclick = () => renderYearLanding(yearKey);
    toolbar.appendChild(backBtn);
    const info = document.createElement('div');
    info.className = 'countdown-pill';
    info.textContent = 'Preview mode · Answers only';
    toolbar.appendChild(info);
    container.appendChild(toolbar);

    ['1A', '1B', '2'].forEach(part => {
        const questions = yearData.parts[part];
        if (!questions || questions.length === 0) return;
        const section = document.createElement('div');
        section.className = 'paper-preview-section';
        const title = document.createElement('h4');
        const labelMap = { '1A': 'Paper 1A · Multiple Choice', '1B': 'Paper 1B · Structured', '2': 'Paper 2 · Elective' };
        title.textContent = labelMap[part] || part;
        section.appendChild(title);
        questions.forEach((q, index) => {
            const card = createPreviewCard(q, index);
            section.appendChild(card);
        });
        container.appendChild(section);
    });
}

function createPreviewCard(q, index) {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = `
        <div style="font-size:0.85em; color:#a0aec0; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:8px;">Q${index + 1} · ${q.topicName || ''}</div>
        <div class="question-text" style="margin-bottom:10px;">${processQuestionContent(q.question)}</div>
    `;
    if (q.image) {
        const img = document.createElement('img');
        img.src = resolveImageUrl(q.image);
        img.style.maxWidth = '100%';
        img.style.marginBottom = '10px';
        card.appendChild(img);
    }

    const answerBlock = document.createElement('div');
    answerBlock.className = 'answer-block';
    if ((q.type || '').toLowerCase() === 'multiple-choice') {
        const options = Array.isArray(q.options) ? q.options : [];
        const optsWrap = document.createElement('div');
        optsWrap.className = 'preview-answer-options';
        options.forEach(opt => {
            const optDiv = document.createElement('div');
            optDiv.className = 'preview-option';
            if (opt.option === q.correctOption) optDiv.classList.add('correct');
            else optDiv.classList.add('incorrect');
            optDiv.innerHTML = `<span style="font-weight:bold; margin-right:10px;">${opt.option}.</span> ${processQuestionContent(opt.content || '')}`;
            optsWrap.appendChild(optDiv);
        });
        answerBlock.appendChild(optsWrap);
    } else if (q.structuralAnswer) {
        answerBlock.innerHTML = `
            <strong>Suggested Answer:</strong>
            <div>${processQuestionContent(q.structuralAnswer.fullAnswer || q.structuralAnswer.subAnswer || 'No answer provided.')}</div>
        `;
    } else {
        answerBlock.textContent = 'No stored answer for this question yet.';
    }
    card.appendChild(answerBlock);

    const stats = getQuestionStatsEntry(q);
    const statLine = document.createElement('div');
    statLine.className = 'question-stats-chip';
    statLine.innerHTML = `<span>Attempts ${stats.attempts || 0}</span><span>Correct ${stats.correct || 0}</span><span>Incorrect ${stats.incorrect || 0}</span>`;
    card.appendChild(statLine);

    return card;
}

function startPaperAttempt(yearKey, mode) {
    const yearData = yearIndex[yearKey];
    if (!yearData) {
        alert('No data for the selected year.');
        return;
    }

    if (activeAttempt && !activeAttempt.finished) {
        const abandon = confirm('You already have an active paper. Abandon it and start a new one?');
        if (!abandon) return;
        if (activeAttempt.timerInterval) clearInterval(activeAttempt.timerInterval);
    }

    const sections = [];
    if (mode === 'paper2') {
        if (yearData.parts['2'].length > 0) {
            sections.push({ part: '2', questions: [...yearData.parts['2']] });
        }
    } else {
        if (yearData.parts['1A'].length > 0) sections.push({ part: '1A', questions: [...yearData.parts['1A']] });
        if (yearData.parts['1B'].length > 0) sections.push({ part: '1B', questions: [...yearData.parts['1B']] });
    }

    if (sections.length === 0) {
        alert('This paper does not contain any questions yet.');
        return;
    }

    const duration = mode === 'paper2' ? 60 * 60 : 150 * 60; // seconds
    activeAttempt = {
        yearKey,
        mode,
        sections,
        responses: {},
        durationSeconds: duration,
        remainingSeconds: duration,
        timerInterval: null,
        startedAt: Date.now(),
        finished: false,
        reviewData: null
    };

    renderPaperAttempt();
    startAttemptTimer();
}

function renderPaperAttempt() {
    if (!activeAttempt) return;
    const container = document.getElementById('year-content');
    if (!container) return;

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'paper-attempt';

    const header = document.createElement('div');
    header.className = 'paper-attempt-header';
    const title = document.createElement('h3');
    title.textContent = `${activeAttempt.yearKey} · ${activeAttempt.mode === 'paper2' ? 'Paper 2' : 'Paper 1'}`;
    header.appendChild(title);

    const timer = document.createElement('div');
    timer.id = 'attempt-timer';
    timer.className = 'attempt-timer';
    timer.textContent = formatSeconds(activeAttempt.remainingSeconds);
    header.appendChild(timer);

    const exitBtn = document.createElement('button');
    exitBtn.className = 'btn btn-warning';
    exitBtn.textContent = 'Abandon Attempt';
    exitBtn.onclick = () => {
        if (confirm('Are you sure you want to abandon this attempt? Progress will be lost.')) {
            if (activeAttempt.timerInterval) clearInterval(activeAttempt.timerInterval);
            const targetYear = activeAttempt.yearKey;
            activeAttempt = null;
            renderYearLanding(targetYear);
        }
    };
    header.appendChild(exitBtn);

    wrapper.appendChild(header);

    activeAttempt.sections.forEach(section => {
        const sectionWrap = document.createElement('div');
        sectionWrap.className = 'paper-question-card';
        const labelMap = { '1A': 'Paper 1A · Multiple Choice', '1B': 'Paper 1B · Structured', '2': 'Paper 2 · Elective' };
        const sectionTitle = document.createElement('h4');
        sectionTitle.textContent = labelMap[section.part] || section.part;
        sectionWrap.appendChild(sectionTitle);

        section.questions.forEach((q, idx) => {
            const qCard = document.createElement('div');
            qCard.className = 'paper-question-card';
            const questionKey = getQuestionKey(q);
            qCard.innerHTML = `
                <div class="question-meta" style="margin-bottom:10px;">
                    <span>${section.part} · Q${idx + 1}</span>
                    <span>${q.topicName || ''}</span>
                    <span>${q.source || ''} ${q.year || ''}</span>
                </div>
                <div class="question-text">${processQuestionContent(q.question)}</div>
            `;

            if (q.image) {
                const img = document.createElement('img');
                img.src = resolveImageUrl(q.image);
                img.style.maxWidth = '100%';
                img.style.margin = '12px 0';
                qCard.appendChild(img);
            }

            const response = activeAttempt.responses[questionKey];
            if ((q.type || '').toLowerCase() === 'multiple-choice') {
                const optionsWrapper = document.createElement('div');
                optionsWrapper.className = 'mcq-options';
                (q.options || []).forEach(opt => {
                    const optionRow = document.createElement('label');
                    optionRow.className = 'mcq-option';
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = getSafeDomId('mc', questionKey);
                    input.value = opt.option;
                    input.style.marginTop = '6px';
                    if (response && response.selected === opt.option) input.checked = true;
                    input.onchange = () => {
                        activeAttempt.responses[questionKey] = { type: 'mcq', selected: opt.option };
                    };
                    optionRow.appendChild(input);
                    const label = document.createElement('div');
                    label.innerHTML = `<strong style="margin-right:8px;">${opt.option}.</strong> ${processQuestionContent(opt.content || '')}`;
                    optionRow.appendChild(label);
                    optionsWrapper.appendChild(optionRow);
                });
                qCard.appendChild(optionsWrapper);
            } else {
                const textarea = document.createElement('textarea');
                textarea.className = 'structural-input';
                textarea.placeholder = 'Type your answer here...';
                textarea.value = response && response.text ? response.text : '';
                textarea.oninput = (e) => {
                    activeAttempt.responses[questionKey] = { type: 'structural', text: e.target.value };
                };
                qCard.appendChild(textarea);
            }

            sectionWrap.appendChild(qCard);
        });

        wrapper.appendChild(sectionWrap);
    });

    const finishBtn = document.createElement('button');
    finishBtn.className = 'btn btn-check';
    finishBtn.textContent = 'Finish Paper & Review';
    finishBtn.onclick = () => finishPaperAttempt(false);
    wrapper.appendChild(finishBtn);

    container.appendChild(wrapper);
}

function startAttemptTimer() {
    if (!activeAttempt) return;
    if (activeAttempt.timerInterval) clearInterval(activeAttempt.timerInterval);
    activeAttempt.timerInterval = setInterval(() => {
        if (!activeAttempt) return;
        activeAttempt.remainingSeconds -= 1;
        if (activeAttempt.remainingSeconds <= 0) {
            updateAttemptTimerDisplay();
            finishPaperAttempt(true);
            return;
        }
        updateAttemptTimerDisplay();
    }, 1000);
    updateAttemptTimerDisplay();
}

function updateAttemptTimerDisplay() {
    const timer = document.getElementById('attempt-timer');
    if (timer && activeAttempt) {
        timer.textContent = formatSeconds(Math.max(activeAttempt.remainingSeconds, 0));
    }
}

function finishPaperAttempt(autoTriggered = false) {
    if (!activeAttempt || activeAttempt.finished) return;
    if (activeAttempt.timerInterval) clearInterval(activeAttempt.timerInterval);
    activeAttempt.finished = true;
    activeAttempt.remainingSeconds = Math.max(0, activeAttempt.remainingSeconds);

    const mcQuestions = [];
    const longQuestions = [];

    activeAttempt.sections.forEach(section => {
        section.questions.forEach(q => {
            const questionKey = getQuestionKey(q);
            const response = activeAttempt.responses[questionKey] || {};
            if ((q.type || '').toLowerCase() === 'multiple-choice') {
                const marks = typeof q.marks === 'number' ? q.marks : 1;
                const isCorrect = response.selected ? response.selected === q.correctOption : false;
                mcQuestions.push({ q, selected: response.selected || null, isCorrect, marks });
            } else {
                const maxMarks = q.marks || q.maxMarks || (q.structuralAnswer && q.structuralAnswer.marks) || (q.structuralAnswer && q.structuralAnswer.totalMarks) || 0;
                longQuestions.push({ q, userText: response.text || '', maxMarks: maxMarks || 0, awarded: 0 });
            }
        });
    });

    const mcTotalMarks = mcQuestions.reduce((sum, row) => sum + (row.marks || 0), 0);
    const mcScore = mcQuestions.reduce((sum, row) => sum + (row.isCorrect ? (row.marks || 0) : 0), 0);
    const longTotalMarks = longQuestions.reduce((sum, row) => sum + (row.maxMarks || 0), 0);

    activeAttempt.reviewData = {
        mcQuestions,
        longQuestions,
        mcTotalMarks,
        mcScore,
        longTotalMarks,
        manualMarks: {}
    };

    renderAnswerReview(autoTriggered);
}

function renderAnswerReview(autoTriggered) {
    if (!activeAttempt || !activeAttempt.reviewData) return;
    const container = document.getElementById('year-content');
    if (!container) return;

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'answer-review';

    const toolbar = document.createElement('div');
    toolbar.className = 'paper-toolbar';
    const info = document.createElement('div');
    info.className = 'countdown-pill';
    info.textContent = autoTriggered ? 'Time up · Review answers' : 'Review & mark long questions';
    toolbar.appendChild(info);
    wrapper.appendChild(toolbar);

    const scoreboard = document.createElement('div');
    scoreboard.className = 'scoreboard';
    scoreboard.innerHTML = `
        <div class="score-chip" id="score-mc">
            <span>Paper 1A Score</span>
            <strong>${activeAttempt.reviewData.mcScore}/${activeAttempt.reviewData.mcTotalMarks}</strong>
        </div>
        <div class="score-chip" id="score-lq">
            <span>Long Question Score</span>
            <strong>0/${activeAttempt.reviewData.longTotalMarks}</strong>
        </div>
        <div class="score-chip" id="score-total">
            <span>Total Score</span>
            <strong>${activeAttempt.reviewData.mcScore}/${activeAttempt.reviewData.mcTotalMarks + activeAttempt.reviewData.longTotalMarks}</strong>
        </div>
    `;
    wrapper.appendChild(scoreboard);

    if (activeAttempt.reviewData.mcQuestions.length > 0) {
        const mcPanel = document.createElement('div');
        mcPanel.className = 'mc-review-list';
        activeAttempt.reviewData.mcQuestions.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = 'mc-review-item';
            item.innerHTML = `
                <span>Q${idx + 1}: ${row.selected || '—'} ➜ ${row.q.correctOption || 'N/A'}</span>
                <span>${row.isCorrect ? '✓ Correct' : '✗'}</span>
            `;
            mcPanel.appendChild(item);
        });
        wrapper.appendChild(mcPanel);
    }

    const lqHeader = document.createElement('h4');
    lqHeader.textContent = 'Long Question Review';
    wrapper.appendChild(lqHeader);

    if (activeAttempt.reviewData.longQuestions.length === 0) {
        const none = document.createElement('div');
        none.className = 'placeholder-text';
        none.style.position = 'static';
        none.textContent = 'No long questions in this paper.';
        wrapper.appendChild(none);
    } else {
        activeAttempt.reviewData.longQuestions.forEach((row, idx) => {
            const qCard = document.createElement('div');
            qCard.className = 'paper-question-card';
            qCard.innerHTML = `
                <div class="question-meta" style="margin-bottom:10px;">
                    <span>Q${idx + 1}</span>
                    <span>${row.q.topicName || ''}</span>
                </div>
                <div class="question-text">${processQuestionContent(row.q.question)}</div>
            `;

            const userAnswer = document.createElement('div');
            userAnswer.className = 'structural-answer';
            const keywords = (row.q.structuralAnswer && row.q.structuralAnswer.keywords) || [];
            userAnswer.innerHTML = `
                <h4>Your Response</h4>
                <div>${row.userText ? highlightWithKeywords(row.userText, keywords) : '<em>No response provided.</em>'}</div>
            `;
            qCard.appendChild(userAnswer);

            const suggested = document.createElement('div');
            suggested.className = 'structural-answer';
            suggested.style.borderLeftColor = '#63b3ed';
            suggested.innerHTML = `
                <h4>Suggested Answer</h4>
                <div>${row.q.structuralAnswer ? processQuestionContent(row.q.structuralAnswer.fullAnswer || '') : 'No answer provided.'}</div>
            `;
            qCard.appendChild(suggested);

            const markInput = document.createElement('div');
            markInput.className = 'mark-input';
            const label = document.createElement('span');
            label.textContent = 'Mark Awarded:';
            markInput.appendChild(label);
            const input = document.createElement('input');
            input.type = 'number';
            input.min = 0;
            input.step = '0.5';
            if (row.maxMarks) input.max = row.maxMarks;
            input.placeholder = '0';
            input.dataset.questionKey = getQuestionKey(row.q);
            input.oninput = (e) => handleManualMarkInput(row, parseFloat(e.target.value));
            markInput.appendChild(input);
            const maxLabel = document.createElement('span');
            maxLabel.textContent = `/ ${row.maxMarks || '—'} marks`;
            markInput.appendChild(maxLabel);
            qCard.appendChild(markInput);

            wrapper.appendChild(qCard);
        });
    }

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-check';
    saveBtn.textContent = 'Finalize & Save Attempt';
    saveBtn.onclick = () => finalizeAttemptSave();
    wrapper.appendChild(saveBtn);

    container.appendChild(wrapper);
}

function handleManualMarkInput(row, value) {
    if (!activeAttempt || !activeAttempt.reviewData || !row) return;
    const safeValue = isNaN(value) ? 0 : Math.max(0, value);
    row.awarded = safeValue;
    const key = getQuestionKey(row.q);
    activeAttempt.reviewData.manualMarks[key] = safeValue;
    updateReviewScoreboard();
}

function updateReviewScoreboard() {
    if (!activeAttempt || !activeAttempt.reviewData) return;
    const longScore = activeAttempt.reviewData.longQuestions.reduce((sum, row) => sum + (row.awarded || 0), 0);
    const scoreLq = document.getElementById('score-lq');
    if (scoreLq) {
        scoreLq.querySelector('strong').textContent = `${longScore}/${activeAttempt.reviewData.longTotalMarks}`;
    }
    const scoreTotal = document.getElementById('score-total');
    if (scoreTotal) {
        const grandTotal = activeAttempt.reviewData.mcTotalMarks + activeAttempt.reviewData.longTotalMarks;
        scoreTotal.querySelector('strong').textContent = `${activeAttempt.reviewData.mcScore + longScore}/${grandTotal}`;
    }
}

function finalizeAttemptSave() {
    if (!activeAttempt || !activeAttempt.reviewData) return;
    const lqRequired = activeAttempt.reviewData.longQuestions.some(row => row.maxMarks > 0);
    if (lqRequired) {
        const incomplete = activeAttempt.reviewData.longQuestions.some(row => row.maxMarks > 0 && (row.awarded === undefined || row.awarded === null));
        if (incomplete) {
            const proceed = confirm('Some long questions have no awarded marks. Save anyway?');
            if (!proceed) return;
        }
    }

    const longScore = activeAttempt.reviewData.longQuestions.reduce((sum, row) => sum + (row.awarded || 0), 0);
    const summary = {
        timestamp: new Date().toISOString(),
        yearKey: activeAttempt.yearKey,
        mode: activeAttempt.mode,
        durationSeconds: activeAttempt.durationSeconds,
        timeUsedSeconds: activeAttempt.durationSeconds - activeAttempt.remainingSeconds,
        mcScore: activeAttempt.reviewData.mcScore,
        mcTotal: activeAttempt.reviewData.mcTotalMarks,
        lqScore: longScore,
        lqTotal: activeAttempt.reviewData.longTotalMarks,
        breakdown: {
            mc: activeAttempt.reviewData.mcQuestions.map(row => ({ question: getQuestionKey(row.q), correct: row.isCorrect })),
            long: activeAttempt.reviewData.longQuestions.map(row => ({ question: getQuestionKey(row.q), awarded: row.awarded || 0, maxMarks: row.maxMarks || 0 }))
        }
    };

    saveAttemptHistoryEntry(summary);

    activeAttempt.reviewData.mcQuestions.forEach(row => {
        recordQuestionAttempt(row.q, row.isCorrect);
    });
    activeAttempt.reviewData.longQuestions.forEach(row => {
        if (row.maxMarks > 0) {
            const given = typeof row.awarded === 'number' ? row.awarded : 0;
            const isPerfect = given >= row.maxMarks;
            recordQuestionAttempt(row.q, row.awarded === undefined ? null : isPerfect);
        } else {
            recordQuestionAttempt(row.q, null);
        }
    });

    alert('Attempt stored locally. Great work!');
    renderYearLanding(activeAttempt.yearKey);
    activeAttempt = null;
}

function saveAttemptHistoryEntry(entry) {
    try {
        const historyRaw = localStorage.getItem(STORAGE_KEYS.attempts);
        const history = historyRaw ? JSON.parse(historyRaw) : [];
        history.push(entry);
        localStorage.setItem(STORAGE_KEYS.attempts, JSON.stringify(history));
    } catch (err) {
        console.error('Unable to save attempt history', err);
    }
}

function formatSeconds(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
}

function renderTopicSidebar() {
    const sidebar = document.getElementById('topic-sidebar');
    sidebar.innerHTML = '';
    
    TOPICS.forEach(topic => {
        const topicQuestions = allQuestions.filter(q => q.topicId === topic.id);
        if (topicQuestions.length === 0) return;
        
        const container = document.createElement('div');
        container.className = 'topic-tree-item';
        
        const header = document.createElement('div');
        header.className = 'topic-header';
        header.title = topic.name; // Tooltip
        // Short name logic: "Topic 1"
        const shortName = topic.name.split(':')[0]; 
        header.innerHTML = `<span>${shortName}</span> <span style="font-size:0.8em">▼</span>`;
        
        const subitems = document.createElement('div');
        subitems.className = 'topic-subitems';
        
        // Sub-items: MCQ and Structural
        const mcqQuestions = topicQuestions.filter(q => q.type === 'Multiple-choice');
        const structQuestions = topicQuestions.filter(q => q.type !== 'Multiple-choice');
        
        // Sort logic for topic questions: Source > Year > Type
        const sortFn = (a, b) => {
            const sourceOrder = { 'DSE': 0, 'CE': 1, 'AL': 2, 'Others': 3 };
            const sA = sourceOrder[a.source] !== undefined ? sourceOrder[a.source] : 3;
            const sB = sourceOrder[b.source] !== undefined ? sourceOrder[b.source] : 3;
            if (sA !== sB) return sA - sB;
            const yA = a.year || 0;
            const yB = b.year || 0;
            return yA - yB;
        };
        
        mcqQuestions.sort(sortFn);
        structQuestions.sort(sortFn);
        
        // Add sub-items
        if (mcqQuestions.length > 0) {
            const mcItem = document.createElement('div');
            mcItem.className = 'subitem';
            mcItem.textContent = 'Multiple choice';
            mcItem.onclick = (e) => {
                e.stopPropagation();
                startSession(mcqQuestions, 'topic-content');
            };
            subitems.appendChild(mcItem);
        }
        
        if (structQuestions.length > 0) {
            const stItem = document.createElement('div');
            stItem.className = 'subitem';
            stItem.textContent = 'Structural question';
            stItem.onclick = (e) => {
                e.stopPropagation();
                startSession(structQuestions, 'topic-content');
            };
            subitems.appendChild(stItem);
        }
        
        // Header click: Toggle or Ask
        header.onclick = () => {
            // Toggle visibility
            const isOpen = subitems.classList.contains('open');
            if (isOpen) {
                subitems.classList.remove('open');
                header.querySelector('span:last-child').textContent = '▼';
            } else {
                subitems.classList.add('open');
                header.querySelector('span:last-child').textContent = '▲';
            }
            
            // Also ask user in main content
            const contentDiv = document.getElementById('topic-content');
            const topicStats = getTopicStats(topic.id);
            contentDiv.innerHTML = `
                <div style="text-align:center; padding: 50px;">
                    <h3>${topic.name}</h3>
                    <p>Select a section to practice:</p>
                    <div style="display:flex; gap:20px; justify-content:center; margin-top:20px;">
                        <button class="btn large" id="btn-mcq-${topic.id}">Multiple Choice (${mcqQuestions.length})</button>
                        <button class="btn large" id="btn-struct-${topic.id}">Structural (${structQuestions.length})</button>
                    </div>
                    <div class="topic-stats-banner">
                        <div><span>Attempts</span><strong>${topicStats.attempts || 0}</strong></div>
                        <div><span>Correct</span><strong>${topicStats.correct || 0}</strong></div>
                        <div><span>Incorrect</span><strong>${topicStats.incorrect || 0}</strong></div>
                    </div>
                </div>
            `;
            
            document.getElementById(`btn-mcq-${topic.id}`).onclick = () => startSession(mcqQuestions, 'topic-content');
            document.getElementById(`btn-struct-${topic.id}`).onclick = () => startSession(structQuestions, 'topic-content');
        };
        
        container.appendChild(header);
        container.appendChild(subitems);
        sidebar.appendChild(container);
    });
}

// --- Session Management ---

function startSession(questions, containerId) {
    if (!questions || questions.length === 0) {
        alert('No questions available in this section.');
        return;
    }
    
    currentSession = {
        questions: questions,
        currentIndex: 0,
        containerId: containerId,
        answers: {}
    };
    
    renderCurrentQuestion();
}

function renderCurrentQuestion() {
    const container = document.getElementById(currentSession.containerId);
    const q = currentSession.questions[currentSession.currentIndex];
    const total = currentSession.questions.length;
    
    container.innerHTML = '';
    
    const card = document.createElement('div');
    card.className = 'question-card';
    
    // Meta
    const meta = document.createElement('div');
    meta.className = 'question-meta';
    meta.innerHTML = `
        <span>Question ${currentSession.currentIndex + 1} of ${total}</span>
        <span>${q.source || ''} ${q.year || ''}</span>
        <span>${q.topicName || ''}</span>
    `;
    card.appendChild(meta);

    const qStats = getQuestionStatsEntry(q);
    const statsChip = document.createElement('div');
    statsChip.className = 'question-stats-chip';
    statsChip.innerHTML = `<span>Attempts ${qStats.attempts || 0}</span><span>Correct ${qStats.correct || 0}</span><span>Incorrect ${qStats.incorrect || 0}</span>`;
    card.appendChild(statsChip);
    
    // Question Text (allow inline images/HTML from stored content)
    const text = document.createElement('div');
    text.className = 'question-text';
    text.innerHTML = processQuestionContent(q.question);
    card.appendChild(text);
    
    // Image
    if (q.image) {
        const img = document.createElement('img');
        img.src = resolveImageUrl(q.image);
        img.style.maxWidth = '100%';
        img.style.marginBottom = '20px';
        card.appendChild(img);
    }
    
    // Content based on type
    const contentDiv = document.createElement('div');
    contentDiv.id = 'question-interaction-area';
    
    if (q.type === 'Multiple-choice') {
        renderMCQInteraction(contentDiv, q);
    } else {
        renderStructuralInteraction(contentDiv, q);
    }
    
    card.appendChild(contentDiv);
    
    // Action Bar
    const actionBar = document.createElement('div');
    actionBar.className = 'action-bar';
    
    // Check Button
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn btn-check';
    checkBtn.textContent = 'Check Answer';
    // Remove ID to avoid duplicates across tabs
    checkBtn.onclick = () => checkAnswer(q, card);
    
    // Skip Button
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-skip';
    skipBtn.textContent = 'Skip';
    // Remove ID
    skipBtn.onclick = () => nextQuestion();
    
    // Next Button (Hidden initially)
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-next';
    nextBtn.textContent = 'Next Question';
    // Remove ID
    nextBtn.style.display = 'none';
    nextBtn.onclick = () => nextQuestion();
    
    actionBar.appendChild(checkBtn);
    actionBar.appendChild(skipBtn);
    actionBar.appendChild(nextBtn);
    
    card.appendChild(actionBar);
    container.appendChild(card);
}

function renderMCQInteraction(container, q) {
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'mcq-options';
    
    if (q.options && Array.isArray(q.options)) {
        q.options.forEach(opt => {
            const optDiv = document.createElement('div');
            optDiv.className = 'mcq-option';
            optDiv.dataset.value = opt.option;
            
            let contentHtml = `<span style="font-weight: bold; margin-right: 10px;">${opt.option}.</span>`;
            contentHtml += `<span>${processQuestionContent(opt.content || '')}</span>`;
            
            optDiv.innerHTML = contentHtml;
            
            if (opt.image) {
                 const optImg = document.createElement('img');
                 optImg.src = resolveImageUrl(opt.image);
                 optImg.style.maxWidth = '200px';
                 optImg.style.display = 'block';
                 optImg.style.marginTop = '5px';
                 optDiv.appendChild(optImg);
            }
            
            optDiv.onclick = () => {
                // Only allow selection if not yet checked
                // Find check button in the current card
                const card = container.closest('.question-card');
                const checkBtn = card ? card.querySelector('.btn-check') : null;
                
                if (checkBtn && checkBtn.style.display === 'none') return;
                
                container.querySelectorAll('.mcq-option').forEach(o => o.classList.remove('selected'));
                optDiv.classList.add('selected');
            };
            
            optionsDiv.appendChild(optDiv);
        });
    }
    container.appendChild(optionsDiv);
}

function renderStructuralInteraction(container, q) {
    const hasSubQuestions = q.structuralAnswer && q.structuralAnswer.subQuestions && q.structuralAnswer.subQuestions.length > 0;

    if (hasSubQuestions) {
        q.structuralAnswer.subQuestions.forEach((sq, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'sub-question-wrapper';
            wrapper.style.marginBottom = '20px';
            wrapper.style.padding = '10px';
            wrapper.style.borderLeft = '3px solid #eee';
            
            // Label + Question
            const label = sq.subLabel ? `<b>${sq.subLabel}</b> ` : '';
            const text = sq.subQuestion || '';
            if (label || text) {
                const qText = document.createElement('div');
                qText.innerHTML = `${label}${processQuestionContent(text)}`;
                qText.style.marginBottom = '10px';
                wrapper.appendChild(qText);
            }
            
            // Input Area
            const inputArea = document.createElement('div');
            inputArea.className = 'structural-input-area';
            
            const toolbar = document.createElement('div');
            toolbar.className = 'rich-text-toolbar';
            const inputId = `sq-input-${index}`;
            toolbar.innerHTML = `
                <button type="button" class="rich-text-btn" onclick="insertTag('${inputId}', 'b')" title="Bold">B</button>
                <button type="button" class="rich-text-btn" onclick="insertTag('${inputId}', 'u')" title="Underline">U</button>
                <button type="button" class="rich-text-btn" onclick="insertTag('${inputId}', 'sup')" title="Superscript">x²</button>
                <button type="button" class="rich-text-btn" onclick="insertTag('${inputId}', 'sub')" title="Subscript">x₂</button>
            `;
            inputArea.appendChild(toolbar);

            const textarea = document.createElement('textarea');
            textarea.className = 'structural-input';
            textarea.placeholder = 'Type your answer here...';
            textarea.id = inputId;
            
            inputArea.appendChild(textarea);
            wrapper.appendChild(inputArea);
            
            // Answer display area (hidden)
            const answerDiv = document.createElement('div');
            answerDiv.className = 'structural-answer sub-answer-display';
            answerDiv.id = `sq-answer-${index}`;
            answerDiv.style.display = 'none';
            wrapper.appendChild(answerDiv);
            
            container.appendChild(wrapper);
        });
        
        // Main answer display (optional, for general comments)
        const mainAnswerDiv = document.createElement('div');
        mainAnswerDiv.className = 'structural-answer';
        mainAnswerDiv.id = 'structural-answer-display';
        mainAnswerDiv.style.display = 'none';
        container.appendChild(mainAnswerDiv);

    } else {
        const inputArea = document.createElement('div');
        inputArea.className = 'structural-input-area';
        
        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'rich-text-toolbar';
        toolbar.innerHTML = `
            <button type="button" class="rich-text-btn" onclick="insertTag('structural-user-input', 'b')" title="Bold">B</button>
            <button type="button" class="rich-text-btn" onclick="insertTag('structural-user-input', 'u')" title="Underline">U</button>
            <button type="button" class="rich-text-btn" onclick="insertTag('structural-user-input', 'sup')" title="Superscript">x²</button>
            <button type="button" class="rich-text-btn" onclick="insertTag('structural-user-input', 'sub')" title="Subscript">x₂</button>
        `;
        inputArea.appendChild(toolbar);

        const textarea = document.createElement('textarea');
        textarea.className = 'structural-input';
        textarea.placeholder = 'Type your answer here...';
        textarea.id = 'structural-user-input';
        
        inputArea.appendChild(textarea);
        container.appendChild(inputArea);
        
        // Answer display area (hidden)
        const answerDiv = document.createElement('div');
        answerDiv.className = 'structural-answer';
        answerDiv.id = 'structural-answer-display';
        answerDiv.style.display = 'none';
        container.appendChild(answerDiv);
    }
}

// Helper for inserting tags (copied from app.js logic)
window.insertTag = function(elementId, tag) {
    const textarea = document.getElementById(elementId);
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    const replacement = `<${tag}>${selectedText}</${tag}>`;
    
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    
    textarea.value = before + replacement + after;
    
    if (selectedText.length > 0) {
        textarea.selectionStart = start;
        textarea.selectionEnd = start + replacement.length;
    } else {
        const newPos = start + tag.length + 2;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
    }
    textarea.focus();
}

function checkAnswer(q, cardElement) {
    const checkBtn = cardElement.querySelector('.btn-check');
    const skipBtn = cardElement.querySelector('.btn-skip');
    const nextBtn = cardElement.querySelector('.btn-next');
    
    if (q.type === 'Multiple-choice') {
        const selected = cardElement.querySelector('.mcq-option.selected');
        if (!selected) {
            alert('Please select an option.');
            return;
        }
        
        const selectedVal = selected.dataset.value;
        const isCorrect = selectedVal === q.correctOption;
        
        // UI Feedback
        const options = cardElement.querySelectorAll('.mcq-option');
        options.forEach(opt => {
            if (opt.dataset.value === q.correctOption) {
                opt.classList.add('correct-answer');
            }
            if (opt.dataset.value === selectedVal && !isCorrect) {
                opt.classList.add('wrong-answer');
            }
        });

        recordQuestionAttempt(q, isCorrect);
        
    } else {
        // Structural
        const hasSubQuestions = q.structuralAnswer && q.structuralAnswer.subQuestions && q.structuralAnswer.subQuestions.length > 0;
        
        if (hasSubQuestions) {
            q.structuralAnswer.subQuestions.forEach((sq, index) => {
                const input = cardElement.querySelector(`#sq-input-${index}`);
                const answerDisplay = cardElement.querySelector(`#sq-answer-${index}`);
                if (!input || !answerDisplay) return;
                
                const userText = input.value;
                
                // Highlight keywords
                let highlightedText = userText;
                if (q.structuralAnswer && q.structuralAnswer.keywords) {
                    q.structuralAnswer.keywords.forEach(keyword => {
                        if (!keyword) return;
                        const regex = new RegExp(`(${keyword})`, 'gi');
                        highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
                    });
                }
                
                let answerHtml = `<h4>Your Answer:</h4><p style="margin-bottom:15px;">${highlightedText}</p>`;
                answerHtml += `<h4>Suggested Answer:</h4>`;
                answerHtml += `<div>${processQuestionContent(sq.subAnswer || 'No answer provided.')}</div>`;
                
                answerDisplay.innerHTML = answerHtml;
                answerDisplay.style.display = 'block';
                input.style.display = 'none';
                // Hide toolbar if present
                if (input.previousElementSibling && input.previousElementSibling.classList.contains('rich-text-toolbar')) {
                    input.previousElementSibling.style.display = 'none';
                }
            });
            
            // Also show main full answer if exists
            const mainAnswerDisplay = cardElement.querySelector('#structural-answer-display');
            if (mainAnswerDisplay && q.structuralAnswer.fullAnswer) {
                let mainHtml = `<h4>General Answer / Notes:</h4>`;
                mainHtml += `${processQuestionContent(q.structuralAnswer.fullAnswer || '')}`;
                if (q.structuralAnswer.image) {
                    mainHtml += `<img src="${resolveImageUrl(q.structuralAnswer.image)}" style="max-width:100%; margin-top:10px;">`;
                }
                mainAnswerDisplay.innerHTML = mainHtml;
                mainAnswerDisplay.style.display = 'block';
            }

        } else {
            const input = cardElement.querySelector('#structural-user-input');
            const userText = input.value;
            const answerDisplay = cardElement.querySelector('#structural-answer-display');
            
            // Highlight keywords
            let highlightedText = userText;
            if (q.structuralAnswer && q.structuralAnswer.keywords) {
                q.structuralAnswer.keywords.forEach(keyword => {
                    if (!keyword) return;
                    const regex = new RegExp(`(${keyword})`, 'gi');
                    highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
                });
            }
            
            // Show full answer
            let answerHtml = `<h4>Your Answer (Keywords Highlighted):</h4><p style="margin-bottom:15px;">${highlightedText}</p>`;
            answerHtml += `<h4>Suggested Answer:</h4>`;
            
            if (q.structuralAnswer) {
                if (q.structuralAnswer.fullAnswer) {
                    answerHtml += `${processQuestionContent(q.structuralAnswer.fullAnswer)}`;
                }
                if (q.structuralAnswer.image) {
                    answerHtml += `<img src="${resolveImageUrl(q.structuralAnswer.image)}" style="max-width:100%; margin-top:10px;">`;
                }
            } else {
                answerHtml += '<p>No suggested answer provided.</p>';
            }
            
            answerDisplay.innerHTML = answerHtml;
            answerDisplay.style.display = 'block';
            input.style.display = 'none'; // Hide input after checking
            // Hide toolbar
            if (input.previousElementSibling && input.previousElementSibling.classList.contains('rich-text-toolbar')) {
                input.previousElementSibling.style.display = 'none';
            }
        }

        recordQuestionAttempt(q, null);
    }
    
    // Toggle Buttons
    checkBtn.style.display = 'none';
    skipBtn.style.display = 'none';
    nextBtn.style.display = 'inline-block';
}

function nextQuestion() {
    currentSession.currentIndex++;
    if (currentSession.currentIndex < currentSession.questions.length) {
        renderCurrentQuestion();
    } else {
        // End of session
        const container = document.getElementById(currentSession.containerId);
        container.innerHTML = `
            <div style="text-align:center; padding: 50px;">
                <h3>Session Complete!</h3>
                <p>You have finished all questions in this section.</p>
                <button class="btn large" onclick="location.reload()">Back to Menu</button>
            </div>
        `;
    }
}

