// Student App Logic

let allQuestions = [];
let currentTab = 'home';
let currentSession = {
    questions: [],
    currentIndex: 0,
    answers: {} // { questionId: { selected: 'A', isCorrect: true } }
};

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
        
        // Initial render sidebars
        renderYearSidebar();
        renderTopicSidebar();
        
    } catch (err) {
        console.error('Error loading questions:', err);
    }
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

// --- Sidebar Rendering ---

function renderYearSidebar() {
    const sidebar = document.getElementById('year-sidebar');
    sidebar.innerHTML = '';
    
    const validSources = ['DSE', 'AL', 'CE'];
    const groups = {};
    
    allQuestions.forEach(q => {
        if (validSources.includes(q.source)) {
            const key = `${q.source} ${q.year || 'Unknown'}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(q);
        }
    });
    
    // Sort keys (DSE 2023 > DSE 2022 ... > AL ... > CE ...)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        // Extract source and year
        const [sourceA, yearA] = a.split(' ');
        const [sourceB, yearB] = b.split(' ');
        
        // Custom source order
        const sourceOrder = { 'DSE': 0, 'AL': 1, 'CE': 2 };
        if (sourceOrder[sourceA] !== sourceOrder[sourceB]) {
            return sourceOrder[sourceA] - sourceOrder[sourceB];
        }
        // Year ascending (smallest to biggest)
        return parseInt(yearA) - parseInt(yearB);
    });
    
    sortedKeys.forEach(key => {
        const item = document.createElement('div');
        item.className = 'sidebar-item';
        item.textContent = key;
        item.onclick = () => {
            // Highlight active
            sidebar.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // Start session
            // Sort: MCQ first, then Structural
            const questions = groups[key].sort((a, b) => {
                const typeA = a.type === 'Multiple-choice' ? 0 : 1;
                const typeB = b.type === 'Multiple-choice' ? 0 : 1;
                return typeA - typeB;
            });
            startSession(questions, 'year-content');
        };
        sidebar.appendChild(item);
    });
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
            contentDiv.innerHTML = `
                <div style="text-align:center; padding: 50px;">
                    <h3>${topic.name}</h3>
                    <p>Select a section to practice:</p>
                    <div style="display:flex; gap:20px; justify-content:center; margin-top:20px;">
                        <button class="btn large" id="btn-mcq-${topic.id}">Multiple Choice (${mcqQuestions.length})</button>
                        <button class="btn large" id="btn-struct-${topic.id}">Structural (${structQuestions.length})</button>
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
    checkBtn.id = 'btn-check';
    checkBtn.onclick = () => checkAnswer(q);
    
    // Skip Button
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-skip';
    skipBtn.textContent = 'Skip';
    skipBtn.id = 'btn-skip';
    skipBtn.onclick = () => nextQuestion();
    
    // Next Button (Hidden initially)
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-next';
    nextBtn.textContent = 'Next Question';
    nextBtn.id = 'btn-next';
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
    optionsDiv.id = 'mcq-options-list';
    
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
                if (document.getElementById('btn-check').style.display === 'none') return;
                
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

function checkAnswer(q) {
    const checkBtn = document.getElementById('btn-check');
    const skipBtn = document.getElementById('btn-skip');
    const nextBtn = document.getElementById('btn-next');
    
    if (q.type === 'Multiple-choice') {
        const selected = document.querySelector('.mcq-option.selected');
        if (!selected) {
            alert('Please select an option.');
            return;
        }
        
        const selectedVal = selected.dataset.value;
        const isCorrect = selectedVal === q.correctOption;
        
        // UI Feedback
        const options = document.querySelectorAll('.mcq-option');
        options.forEach(opt => {
            if (opt.dataset.value === q.correctOption) {
                opt.classList.add('correct-answer');
            }
            if (opt.dataset.value === selectedVal && !isCorrect) {
                opt.classList.add('wrong-answer');
            }
        });
        
    } else {
        // Structural
        const hasSubQuestions = q.structuralAnswer && q.structuralAnswer.subQuestions && q.structuralAnswer.subQuestions.length > 0;
        
        if (hasSubQuestions) {
            q.structuralAnswer.subQuestions.forEach((sq, index) => {
                const input = document.getElementById(`sq-input-${index}`);
                const answerDisplay = document.getElementById(`sq-answer-${index}`);
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
            const mainAnswerDisplay = document.getElementById('structural-answer-display');
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
            const input = document.getElementById('structural-user-input');
            const userText = input.value;
            const answerDisplay = document.getElementById('structural-answer-display');
            
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

