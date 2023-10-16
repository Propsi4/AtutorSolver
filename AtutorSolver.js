// ==UserScript==
// @name         AtutorSolver
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Helps to solve tests with ChatGPT
// @author       Propsi4
// @include      https://dl.tntu.edu.ua/mods/_standard/tests/*.php?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=dl.tntu.edu.ua
// @license      MIT
// @grant        none
// ==/UserScript==


const API_KEY = ""
const url = " https://api.openai.com/v1/chat/completions"
const xhr = new XMLHttpRequest();
let hide = false

const api_fetch = (data) => {
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${API_KEY}`);
    const prompt = data.question_div.children[2].value
    xhr.onreadystatechange = function () {
    if (xhr.readyState === 4 && xhr.status === 200) {
        try{
        const response = JSON.parse(xhr.responseText);
        const reply = response.choices[0].message.content
        const reply_div = document.createElement("div")
        reply_div.innerHTML = reply
        data.question_div.appendChild(reply_div)
        } catch (error) {
            console.error(error)
        }
    }
    else if(xhr.readyState === 4 && xhr.status === 429){
        alert("Cпробуйте ще раз через 1 хвилину.\n Причини:\n1.Забагато запитів в хвилину.\n2 Можливо, ваш API ключ - не дійсний.")
    }
}
    console.log(prompt)
    const payload = {
        messages: [
            {
                "role": "user",
                "content": prompt
            },
        ],
        model: "gpt-3.5-turbo",
        max_tokens: 50 // Adjust the parameters as needed
      };
    xhr.send(JSON.stringify(payload));
}

const hide_divs = (hide, divs) => {
    if(hide){
            divs.forEach(div => {
                // hide children >= 2
                Array.from(div.children).forEach((child, index) => {
                    if(index >= 2){
                        child.style.display = "none"
                    }
                })
            })
        }else{
            divs.forEach(div => {
                // hide children >= 2
                Array.from(div.children).forEach((child, index) => {
                    if(index >= 2){
                        child.style.display = "block"
                    }
                })
            })
        }
}

(function() {
    'use strict';

    // Your code here...
    const row_divs = document.getElementsByClassName("row")
    const page_wrap = document.getElementsByClassName("page-wrap")[0]
    const hide_button = document.createElement("button")
    hide_button.innerText = "X"
    hide_button.style.position = "fixed"
    hide_button.style.top = "0"
    hide_button.style.right = "0"
    hide_button.style.zIndex = "1000"
    let hide = false

    page_wrap.appendChild(hide_button)
    // get only divs with children p and ul.multichoice-question
    // do not use children[0] and children[1] because it is not reliable
    // may contain input, dont skip it
    const question_divs = Array.from(row_divs).filter(row_div => {
        const children = Array.from(row_div.children)
        const has_p = children.some(child => child.tagName === "P")
        const has_ul = children.some(child => child.tagName === "UL" && (child.classList.contains("multichoice-question") || child.classList.contains("multianswer-question")))
        // yes if div has input tag
        // is multichoice-question or multianswer-question, must be string
        return has_p && has_ul
    })

        hide_button.onclick = () => {
        hide = !hide
        hide_divs(hide, question_divs)
    }
    document.addEventListener('keydown', function(event) {
      if (event.shiftKey && event.key === 'Z') {
        hide = !hide
        hide_divs(hide, question_divs)
    }
    });

   document.addEventListener('mousedown', function(event) {
    if (event.button === 1) {
        hide = !hide
        hide_divs(hide, question_divs)
    }
   });

    const question_data = question_divs.map(question_div => {
        const question_text = question_div.children[0].innerText
        // if question ul class is multichoice-question, then it is multichoice question
        // get ul tag
        const type = Array.from(question_div.children).find(child => child.tagName === "UL").classList[0]
        // ignore last answer, because it is "I don't know"
        if(type == "multichoice-question"){
        const answers = Array.from(question_div.children[1].children).slice(0, -1).map(answer_div => {
            // try to get answer input, if error then skip
            try{
                const answer_input = answer_div.children[0]
                const answer_text = answer_div.children[1].innerText
                return {
                    answer_text,
                    answer_input
                }
            } catch (error) {
                return null
            }})
        return {
            question_div,
            question_text,
            type,
            answers
        }
    }else{
        const answers = Array.from(question_div.children[2].children).map(answer_div => {
            // try to get answer input, if error then skip
            try{
                const answer_input = answer_div.children[0]
                const answer_text = answer_div.children[1].innerText
                return {
                    answer_text,
                    question_div,
                    answer_input
                }
            } catch (error) {
                return null
            }})
        return {
            question_div,
            question_text,
            type,
            answers
        }
    }})

    // add a button to every question_div
    question_divs.forEach((question_div, question_index) => {
        const button = document.createElement("button")
        const textarea = document.createElement("textarea")
        const {question_text, type, answers} = question_data[question_index]
        // Приклад твоєї відповіді: "ТЕКСТ ВАРІАНТУ ВІДПОВІДІ", де "ТЕКСТ ВАРІАНТУ ВІДПОВІДІ" - це текст, який знаходиться біля кожного з варіанту відповіді на це запитання, вказані нижче, якщо такого варіанту немає, то напиши свій варіант відповіді, якщо їх декілька, то перелічи їх через кому. Відповідь повинна бути надана тільки в такому виді, і ніяк інакше.
        let prompt = `Кількість правильних відповідей: ${type == "multichoice-question" ? "Одна правильна відповідь" : "Декілька правильних відповідей"}
Запитання: ${question_text}\n${answers.map((answer, index) =>
            `Відповідь ${index + 1}: ${answer?.answer_text}`).join("\n")}`

        textarea.style.width = "100%"
        textarea.style.height = "100px"
        textarea.style.resize = "none"
        textarea.value = prompt
        textarea.placeholder = "ChatGPT Prompt"

        button.innerText = "Розв'язати"
        button.onclick = (e) => {
            e.preventDefault();
            api_fetch(question_data[question_index])
        }

        question_div.appendChild(textarea)
        question_div.appendChild(button)
    })


})();
