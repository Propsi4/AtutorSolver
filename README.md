# 🎓 AtutorSolver (AI Test Assistant)

A powerful Tampermonkey userscript designed to seamlessly integrate AI into the Atutor test-taking interface. This script allows you to solve multiple-choice and multiple-answer questions using **Google Gemini (Cloud)** or **Ollama (Local Offline AI)**. 

[![Install from Greasy Fork](https://img.shields.io/badge/Install_from-Greasy_Fork-green?style=for-the-badge&logo=tampermonkey)](https://greasyfork.org/en/scripts/474734-atutorsolver)

---

## ✨ Key Features

*   **🤖 Dual AI Providers:** Switch between Google Gemini (fast, accurate) and Local Ollama (100% private, offline) directly from the on-screen UI.
*   **⚡ Batch Solving:** Bundles all questions into a single, highly optimized AI request to solve an entire page in seconds.
*   **👁️ Full Visual/Image Support:** Automatically detects if a question or its answers contain images/formulas. It takes a silent, on-the-fly screenshot and sends it to multimodal vision models.
*   **🔓 Unblock Copy & Paste:** Automatically bypasses website restrictions, restoring right-click, text selection, and copy/paste functionality.
*   **⏱️ Smart Rate Limit Handling:** Automatically detects API rate limits (HTTP 429) and initiates a visual countdown before retrying.
*   **🥷 Stealth Mode:** Instantly hide or show the entire AI interface by **Middle-Clicking** anywhere on the page or pressing `Shift + Z`.

---

## 🛠️ Installation

1. **Install a Userscript Manager:**
   * Download and install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser.
2. **Install AtutorSolver:**
   * Go to the **[AtutorSolver Greasy Fork Page](https://greasyfork.org/en/scripts/474734-atutorsolver)**.
   * Click the green **"Install this script"** button.

---

## ⚙️ Configuration & Setup

Once the script is installed, open an Atutor test page. A floating **"🤖 AI Assistant" Master Panel** will appear in the bottom right corner.

### Option A: Using Google Gemini (Recommended)
1. Get a free API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click your Tampermonkey extension icon in the browser toolbar.
3. Under the *AtutorSolver* script, click **"Set Gemini API Key"**.
4. Paste your key and refresh the page. 
5. Select `☁️ Google Gemini` in the Master Panel and pick your preferred model (e.g., `gemini-3.1-flash-lite`).

### Option B: Using Local Ollama (Offline Privacy)
1. Download and install [Ollama](https://ollama.com/).
2. Pull a model via your terminal (e.g., `ollama run llama3` or `ollama run llava` for image support).
3. Select `🖥️ Local Ollama` in the Master Panel. The script will auto-detect your downloaded models.
   * *(Note: If your Ollama server runs on a custom port, use the Tampermonkey menu -> **"Set Ollama URL"** to update it).*

---

## 🚀 How to Use

*   **Individual Solving:** Click the **✨ Solve with AI** button injected above any specific question to solve just that one.
*   **Batch Solve (Fast):** Click this in the Master Panel to bundle all questions on the page into a single AI prompt. This avoids rate limits and finishes in seconds.
*   **Solve Sequential (Safe):** Solves questions one by one. Useful if the test contains heavily complex images that might exceed payload sizes if batched.
*   **Stealth Mode:** Press `Shift + Z` or click your `Middle Mouse Button` to instantly toggle the visibility of the Master Panel and all AI buttons.

---

## ⚠️ Disclaimer & Educational Notice

This script is provided for educational and developmental purposes only. Users are solely responsible for how they use this tool. Please abide by your institution's academic integrity policies and guidelines. The author assumes no liability for any academic or account-related consequences resulting from the use of this script.
