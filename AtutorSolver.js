// ==UserScript==
// @name         AtutorSolver
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Helps solve tests using AI. Supports Google Gemini and local Ollama, bypasses copy-paste restrictions, batch solving with strict JSON key enforcement.
// @author       Propsi4
// @match        https://dl.tntu.edu.ua/mods/_standard/tests/take_test*.php?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=dl.tntu.edu.ua
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @connect      generativelanguage.googleapis.com
// @connect      localhost
// @connect      127.0.0.1
// @downloadURL https://update.greasyfork.org/scripts/474734/AtutorSolver.user.js
// @updateURL https://update.greasyfork.org/scripts/474734/AtutorSolver.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. CONFIGURATION & STATE
    // ==========================================
    let PROVIDER = GM_getValue('AI_PROVIDER', 'gemini'); 
    let API_KEY = GM_getValue('GEMINI_API_KEY', '');
    let OLLAMA_URL = GM_getValue('OLLAMA_URL', 'http://localhost:11434');
    
    let SELECTED_GEMINI_MODEL = GM_getValue('GEMINI_MODEL', '');
    let SELECTED_OLLAMA_MODEL = GM_getValue('OLLAMA_MODEL', '');
    let isHidden = false;

    GM_registerMenuCommand('Set Gemini API Key', () => {
        const key = prompt('Enter your Gemini API Key:', API_KEY);
        if (key !== null) {
            GM_setValue('GEMINI_API_KEY', key.trim());
            API_KEY = key.trim();
            alert('API Key saved!');
            if (PROVIDER === 'gemini') loadUIModels();
        }
    });

    GM_registerMenuCommand('Set Ollama URL', () => {
        const url = prompt('Enter Ollama Base URL:', OLLAMA_URL);
        if (url !== null) {
            GM_setValue('OLLAMA_URL', url.trim());
            OLLAMA_URL = url.trim();
            alert('Ollama URL saved!');
            if (PROVIDER === 'ollama') loadUIModels();
        }
    });

    // ==========================================
    // 2. UNBLOCK COPY & PASTE
    // ==========================================
    function unblockCopyPaste() {
        const style = document.createElement('style');
        style.innerHTML = `
            * {
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                user-select: text !important;
            }
        `;
        document.head.appendChild(style);

        const removeInlineHandlers = () => {
            if (!document.body) return;
            const attributes = ['oncopy', 'onpaste', 'oncut', 'onselectstart', 'oncontextmenu', 'ondragstart'];
            attributes.forEach(attr => document.body.removeAttribute(attr));
        };
        
        const eventsToUnblock = ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'];
        eventsToUnblock.forEach(eventType => {
            document.addEventListener(eventType, function(e) { e.stopPropagation(); }, true); 
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', removeInlineHandlers);
        } else {
            removeInlineHandlers();
        }
    }

    // ==========================================
    // 3. DOM PARSING
    // ==========================================
    function getQuestions() {
        const rows = Array.from(document.querySelectorAll('.row'));
        const questions = [];

        rows.forEach((row, index) => {
            const p = row.querySelector('p');
            const ul = row.querySelector('ul.multichoice-question, ul.multianswer-question');
            
            if (!p || !ul) return;

            const isMultiChoice = ul.classList.contains('multichoice-question');
            const type = isMultiChoice ? 'single' : 'multiple';
            
            const listItems = Array.from(ul.children);
            if (isMultiChoice) listItems.pop(); 

            const answers = listItems.map(li => {
                const input = li.querySelector('input');
                const text = li.innerText.replace(input?.value || '', '').trim(); 
                return { input, text };
            }).filter(a => a.input);

            questions.push({
                id: index,
                container: row,
                ulElement: ul, 
                questionText: p.innerText.trim(),
                hasImages: row.querySelector('img') !== null,
                type,
                answers
            });
        });

        return questions;
    }

    // ==========================================
    // 4. API ABSTRACTION LAYER
    // ==========================================
    async function fetchModels() {
        if (PROVIDER === 'gemini') {
            if (!API_KEY) return [];
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`,
                    onload: (res) => {
                        if (res.status === 200) {
                            try {
                                const data = JSON.parse(res.responseText);
                                const valid = data.models.filter(m => m.supportedGenerationMethods?.includes("generateContent"));
                                resolve(valid.map(m => ({ id: m.name, name: m.displayName || m.name.replace('models/', '') })));
                            } catch (e) { resolve([]); }
                        } else { resolve([]); }
                    },
                    onerror: () => resolve([])
                });
            });
        } else {
            if (!OLLAMA_URL) return [];
            const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/tags`;
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: endpoint,
                    onload: (res) => {
                        if (res.status === 200) {
                            try {
                                const data = JSON.parse(res.responseText);
                                resolve((data.models || []).map(m => ({ id: m.name, name: m.name })));
                            } catch (e) { resolve([]); }
                        } else { resolve([]); }
                    },
                    onerror: () => resolve([])
                });
            });
        }
    }

    function extractJSON(text, isBatch) {
        if (isBatch) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
            throw new Error("Failed to parse batch JSON");
        } else {
            const match = text.match(/\[(.*?)\]/); 
            if (match) return JSON.parse(`[${match[1]}]`);
            throw new Error("Failed to parse array");
        }
    }

    async function executeRequest(url, payload, onWaitUpdate, isBatch, parserCallback) {
        const makeReq = () => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                onload: (res) => {
                    if (res.status === 429) return reject({ status: 429, message: "Rate limit" });
                    if (res.status !== 200) return reject({ status: res.status, message: res.responseText });
                    
                    try {
                        const rawText = parserCallback(JSON.parse(res.responseText));
                        resolve(extractJSON(rawText, isBatch));
                    } catch (e) {
                        reject({ status: 500, message: "Parse error" });
                    }
                },
                onerror: () => reject({ status: 500, message: "Network Error" })
            });
        });

        let retries = 4;
        let waitSeconds = 15;
        while (retries > 0) {
            try { return await makeReq(); } 
            catch (err) {
                if (err.status === 429 && retries > 1) {
                    retries--;
                    for (let i = waitSeconds; i > 0; i--) {
                        if (onWaitUpdate) onWaitUpdate(i);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    waitSeconds = Math.min(waitSeconds * 2, 60);
                    if (onWaitUpdate) onWaitUpdate(0); 
                } else {
                    throw new Error(err.message || "Unknown API Error");
                }
            }
        }
    }

    // ==========================================
    // 5. SOLVER ROUTINES
    // ==========================================
    async function askAI(questionData, captureBase64 = null, onWaitUpdate = null) {
        const promptText = `You are a test-solving assistant.\nType: ${questionData.type === 'single' ? 'Select EXACTLY ONE' : 'Select ALL correct options'}\nQuestion: ${questionData.questionText || "[See visual content]"}\nOptions:\n${questionData.answers.map((a, i) => `[${i}] ${a.text || '[Visual Option]'}`).join('\n')}\nCRITICAL INSTRUCTION: Return ONLY a raw JSON array containing the integer indices of the correct options. No markdown formatting. Example: [0] or [1, 3]`;

        if (PROVIDER === 'gemini') {
            if (!API_KEY || !SELECTED_GEMINI_MODEL) throw new Error('API Key or Model not set.');
            const parts = [{ text: promptText }];
            if (captureBase64) parts.push({ inlineData: { mimeType: "image/png", data: captureBase64.split(',')[1] } });
            
            const url = `https://generativelanguage.googleapis.com/v1beta/${SELECTED_GEMINI_MODEL}:generateContent?key=${API_KEY}`;
            const payload = { contents: [{ parts }], generationConfig: { temperature: 0.1 } };
            return executeRequest(url, payload, onWaitUpdate, false, (data) => data.candidates[0].content.parts[0].text);
            
        } else {
            if (!OLLAMA_URL || !SELECTED_OLLAMA_MODEL) throw new Error('Ollama URL or Model not set.');
            const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
            const payload = { model: SELECTED_OLLAMA_MODEL, prompt: promptText, stream: false, options: { temperature: 0.1 } };
            if (captureBase64) payload.images = [captureBase64.split(',')[1]];
            
            return executeRequest(url, payload, onWaitUpdate, false, (data) => data.response);
        }
    }

    async function askAIBatch(questions, onWaitUpdate = null) {
        // Build a strict expected keys list so the AI doesn't skip the last one
        const expectedKeys = questions.map(q => `"${q.id}"`).join(', ');
        
        let promptText = `You are a test-solving expert. I will provide a batch of ${questions.length} questions.\nCRITICAL INSTRUCTION: Return ONLY a raw JSON object where keys are the specific Question IDs and values are arrays containing the integer indices of the correct options. Do not wrap in markdown.\nFormat: {"0": [1], "1": [0, 2]}\nYou MUST include exactly these keys in your JSON response: ${expectedKeys}\n\nQUESTIONS:\n`;
        
        const imagesBase64 = [];
        const parts = [];

        for (const q of questions) {
            promptText += `\n---\nID: ${q.id}\nType: ${q.type === 'single' ? 'Select EXACTLY ONE' : 'Select ALL correct'}\nQuestion: ${q.questionText || "[See visual content]"}\nOptions:\n${q.answers.map((a, i) => `[${i}] ${a.text || '[Visual Option]'}`).join('\n')}\n`;
            
            if (q.questionText.length < 10 || q.hasImages) {
                const btn = q.container.querySelector('.ai-solve-btn');
                if (btn) btn.style.display = 'none';
                const canvas = await html2canvas(q.container);
                if (btn) btn.style.display = 'block';
                
                const b64 = canvas.toDataURL('image/png').split(',')[1];
                imagesBase64.push(b64);
                
                parts.push({ text: `Image for Question ID ${q.id}:` });
                parts.push({ inlineData: { mimeType: "image/png", data: b64 } });
                
                if (PROVIDER === 'ollama') promptText += `[Image Attached for ID ${q.id}]\n`;
            }
        }

        // Cap the prompt with a firm ending to force generation
        promptText += `\n--- END OF QUESTIONS ---\nRemember, output ONLY the JSON object containing ALL ${questions.length} keys (${expectedKeys}).`;

        parts.unshift({ text: promptText });

        if (PROVIDER === 'gemini') {
            if (!API_KEY || !SELECTED_GEMINI_MODEL) throw new Error('API Key or Model not set.');
            const url = `https://generativelanguage.googleapis.com/v1beta/${SELECTED_GEMINI_MODEL}:generateContent?key=${API_KEY}`;
            const payload = { contents: [{ parts }], generationConfig: { temperature: 0.1 } };
            return executeRequest(url, payload, onWaitUpdate, true, (data) => data.candidates[0].content.parts[0].text);
            
        } else {
            if (!OLLAMA_URL || !SELECTED_OLLAMA_MODEL) throw new Error('Ollama URL or Model not set.');
            const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
            const payload = { model: SELECTED_OLLAMA_MODEL, prompt: promptText, stream: false, options: { temperature: 0.1 } };
            if (imagesBase64.length > 0) payload.images = imagesBase64; 
            
            return executeRequest(url, payload, onWaitUpdate, true, (data) => data.response);
        }
    }

    // ==========================================
    // 6. UI ACTIONS
    // ==========================================
    function applyAnswersToQuestion(q, indices, btn) {
        q.answers.forEach(a => {
            a.input.checked = false;
            a.input.parentElement.style.backgroundColor = '';
        });
        indices.forEach(idx => {
            if (q.answers[idx]) {
                q.answers[idx].input.click(); 
                q.answers[idx].input.parentElement.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
            }
        });
        if (btn) {
            btn.innerText = "Solved ✓";
            btn.style.backgroundColor = "#4caf50";
            btn.dataset.running = "false";
        }
    }

    async function solveQuestion(q) {
        const btn = q.container.querySelector('.ai-solve-btn');
        if (btn.dataset.running === "true") return;
        
        btn.dataset.running = "true";
        btn.innerText = "Thinking...";
        btn.style.backgroundColor = "#ffc107";

        try {
            let screenshot = null;
            if (q.questionText.length < 10 || q.hasImages) {
                btn.style.display = 'none';
                const canvas = await html2canvas(q.container);
                btn.style.display = 'block';
                screenshot = canvas.toDataURL('image/png');
            }

            const correctIndices = await askAI(q, screenshot, (timeLeft) => {
                if (timeLeft > 0) {
                    btn.innerText = `Rate Limit! ${timeLeft}s...`;
                    btn.style.backgroundColor = "#ff9800";
                } else {
                    btn.innerText = "Thinking (Retry)...";
                    btn.style.backgroundColor = "#ffc107";
                }
            });
            
            applyAnswersToQuestion(q, correctIndices, btn);
        } catch (error) {
            btn.innerText = "Error (See Console)";
            btn.style.backgroundColor = "#f44336";
            btn.dataset.running = "false";
            console.error(error);
        }
    }

    async function batchSolveAll() {
        const questions = getQuestions();
        if (questions.length === 0) return;

        const btns = [document.getElementById('ai-solve-all-btn'), document.getElementById('ai-batch-solve-btn')];
        const progressContainer = document.getElementById('ai-progress-container');
        const progressFill = document.getElementById('ai-progress-fill');
        const progressText = document.getElementById('ai-progress-text');

        btns.forEach(b => b && (b.disabled = true));
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressText) {
            progressText.style.display = 'block';
            progressText.innerText = `Batch Sending ${questions.length} questions...`;
        }
        if (progressFill) progressFill.style.width = '50%';

        questions.forEach(q => {
            const btn = q.container.querySelector('.ai-solve-btn');
            btn.dataset.running = "true";
            btn.innerText = "Batch Processing...";
            btn.style.backgroundColor = "#2196f3";
        });

        try {
            const batchResults = await askAIBatch(questions, (timeLeft) => {
                if (progressText) {
                    progressText.innerText = timeLeft > 0 ? `Rate Limit! Retrying in ${timeLeft}s...` : "Retrying Batch...";
                    progressFill.style.backgroundColor = timeLeft > 0 ? "#ff9800" : "#2196f3";
                }
            });

            let solvedCount = 0;
            questions.forEach(q => {
                const btn = q.container.querySelector('.ai-solve-btn');
                const indices = batchResults[q.id.toString()];
                if (indices && Array.isArray(indices)) {
                    applyAnswersToQuestion(q, indices, btn);
                    solvedCount++;
                } else {
                    btn.innerText = "Missed in Batch";
                    btn.style.backgroundColor = "#f44336";
                    btn.dataset.running = "false";
                }
            });

            if (progressFill) {
                progressFill.style.width = '100%';
                progressFill.style.backgroundColor = "#4caf50";
            }
            if (progressText) progressText.innerText = `Batch Complete! (${solvedCount}/${questions.length})`;

        } catch (error) {
            console.error(error);
            if (progressText) progressText.innerText = "Batch Error. Try sequential mode.";
            if (progressFill) progressFill.style.backgroundColor = "#f44336";
            questions.forEach(q => {
                const btn = q.container.querySelector('.ai-solve-btn');
                btn.innerText = "Batch Failed";
                btn.style.backgroundColor = "#f44336";
                btn.dataset.running = "false";
            });
        } finally {
            btns.forEach(b => b && (b.disabled = false));
        }
    }

    async function solveAll() {
        const questions = getQuestions();
        const total = questions.length;
        if (total === 0) return;

        const btns = [document.getElementById('ai-solve-all-btn'), document.getElementById('ai-batch-solve-btn')];
        const progressContainer = document.getElementById('ai-progress-container');
        const progressFill = document.getElementById('ai-progress-fill');
        const progressText = document.getElementById('ai-progress-text');

        btns.forEach(b => b && (b.disabled = true));
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressText) {
            progressText.style.display = 'block';
            progressText.innerText = `0 / ${total} Solved`;
        }
        if (progressFill) {
            progressFill.style.width = '0%';
            progressFill.style.backgroundColor = "#4caf50";
        }

        for (let i = 0; i < total; i++) {
            await solveQuestion(questions[i]);
            const current = i + 1;
            if (progressFill) progressFill.style.width = `${(current / total) * 100}%`;
            if (progressText) progressText.innerText = `${current} / ${total} Solved`;
            if (current < total) await new Promise(r => setTimeout(r, 100));
        }

        if (progressText) progressText.innerText = "Sequential Solving Done! 🎉";
        btns.forEach(b => b && (b.disabled = false));
    }

    // ==========================================
    // 7. UI INJECTION & STATE MANGEMENT
    // ==========================================
    async function loadUIModels() {
        const select = document.getElementById('ai-model-select');
        if (!select) return;

        select.innerHTML = '<option value="">Loading models...</option>';
        const models = await fetchModels();

        if (models.length === 0) {
            select.innerHTML = PROVIDER === 'gemini' ? '<option value="">Invalid API Key</option>' : '<option value="">Ollama Offline or No Models</option>';
            return;
        }

        select.innerHTML = '';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.innerText = m.name;
            const saved = PROVIDER === 'gemini' ? SELECTED_GEMINI_MODEL : SELECTED_OLLAMA_MODEL;
            if (m.id === saved) opt.selected = true;
            select.appendChild(opt);
        });

        const currentSaved = PROVIDER === 'gemini' ? SELECTED_GEMINI_MODEL : SELECTED_OLLAMA_MODEL;
        if (!currentSaved && models.length > 0) {
            if (PROVIDER === 'gemini') {
                SELECTED_GEMINI_MODEL = models[0].id;
                GM_setValue('GEMINI_MODEL', SELECTED_GEMINI_MODEL);
            } else {
                SELECTED_OLLAMA_MODEL = models[0].id;
                GM_setValue('OLLAMA_MODEL', SELECTED_OLLAMA_MODEL);
            }
        }
    }

    async function injectUI() {
        const questions = getQuestions();
        questions.forEach(q => {
            if (q.container.querySelector('.ai-solve-btn')) return;

            const btn = document.createElement('button');
            btn.className = 'ai-solve-btn atutor-ai-element';
            btn.innerText = '✨ Solve with AI';
            btn.dataset.running = "false";
            btn.style.cssText = 'margin: 10px 0; padding: 5px 10px; cursor: pointer; border: none; border-radius: 4px; background-color: #2196f3; color: white; font-weight: bold; display: block;';
            btn.onclick = (e) => { e.preventDefault(); solveQuestion(q); };
            
            if (q.ulElement && q.ulElement.parentNode) q.ulElement.parentNode.insertBefore(btn, q.ulElement);
            else q.container.appendChild(btn); 
        });

        if (!document.getElementById('ai-master-panel')) {
            const panel = document.createElement('div');
            panel.id = 'ai-master-panel';
            panel.className = 'atutor-ai-element';
            panel.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 9999; border: 1px solid #ddd; width: 220px;';
            
            const title = document.createElement('div');
            title.innerText = '🤖 AI Assistant';
            title.style.cssText = 'font-weight: bold; margin-bottom: 10px; font-family: sans-serif; text-align: center;';
            
            const providerSelect = document.createElement('select');
            providerSelect.style.cssText = 'width: 100%; margin-bottom: 5px; padding: 5px; border-radius: 4px; border: 1px solid #ccc; font-weight: bold;';
            providerSelect.innerHTML = `<option value="gemini" ${PROVIDER === 'gemini' ? 'selected' : ''}>☁️ Google Gemini</option>
                                        <option value="ollama" ${PROVIDER === 'ollama' ? 'selected' : ''}>🖥️ Local Ollama</option>`;
            
            providerSelect.addEventListener('change', (e) => {
                PROVIDER = e.target.value;
                GM_setValue('AI_PROVIDER', PROVIDER);
                loadUIModels();
            });

            const modelSelect = document.createElement('select');
            modelSelect.id = 'ai-model-select';
            modelSelect.style.cssText = 'width: 100%; margin-bottom: 10px; padding: 5px; border-radius: 4px; border: 1px solid #ccc;';
            
            modelSelect.addEventListener('change', (e) => {
                if (PROVIDER === 'gemini') {
                    SELECTED_GEMINI_MODEL = e.target.value;
                    GM_setValue('GEMINI_MODEL', SELECTED_GEMINI_MODEL);
                } else {
                    SELECTED_OLLAMA_MODEL = e.target.value;
                    GM_setValue('OLLAMA_MODEL', SELECTED_OLLAMA_MODEL);
                }
            });

            const batchSolveBtn = document.createElement('button');
            batchSolveBtn.id = 'ai-batch-solve-btn';
            batchSolveBtn.innerText = '⚡ Batch Solve (Fast)';
            batchSolveBtn.style.cssText = 'padding: 8px 15px; background: #009688; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%; margin-bottom: 5px; font-weight: bold;';
            batchSolveBtn.onclick = batchSolveAll;

            const solveAllBtn = document.createElement('button');
            solveAllBtn.id = 'ai-solve-all-btn';
            solveAllBtn.innerText = 'Solve Sequential (Safe)';
            solveAllBtn.style.cssText = 'padding: 8px 15px; background: #9c27b0; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;';
            solveAllBtn.onclick = solveAll;

            const progressContainer = document.createElement('div');
            progressContainer.id = 'ai-progress-container';
            progressContainer.style.cssText = 'width: 100%; height: 8px; background-color: #eee; border-radius: 4px; margin-top: 10px; display: none; overflow: hidden;';
            const progressFill = document.createElement('div');
            progressFill.id = 'ai-progress-fill';
            progressFill.style.cssText = 'width: 0%; height: 100%; background-color: #4caf50; transition: width 0.3s ease, background-color 0.3s;';
            progressContainer.appendChild(progressFill);

            const progressText = document.createElement('div');
            progressText.id = 'ai-progress-text';
            progressText.style.cssText = 'font-size: 12px; font-weight: bold; text-align: center; margin-top: 5px; color: #333; display: none;';

            const helpText = document.createElement('div');
            helpText.innerText = 'Mid-Click or Shift+Z to hide';
            helpText.style.cssText = 'font-size: 10px; color: #888; margin-top: 10px; text-align: center;';

            panel.append(title, providerSelect, modelSelect, batchSolveBtn, solveAllBtn, progressContainer, progressText, helpText);
            document.body.appendChild(panel);

            loadUIModels();
        }
    }

    function toggleStealth() {
        isHidden = !isHidden;
        document.querySelectorAll('.atutor-ai-element').forEach(el => el.style.display = isHidden ? 'none' : 'block');
    }

    document.addEventListener('keydown', (e) => { if (e.shiftKey && e.key.toLowerCase() === 'z') toggleStealth(); });
    document.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); toggleStealth(); } });

    unblockCopyPaste();
    setTimeout(injectUI, 1000);
})();
