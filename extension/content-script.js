(() => {
  if (globalThis.__jobsDevAutofillLoaded) return;
  globalThis.__jobsDevAutofillLoaded = true;

  const firstNamePattern = /имя|first\s*name|given[-_\s]*name/i;
  const lastNamePattern = /фамилия|last\s*name|surname|family[-_\s]*name/i;
  const emailPattern = /e[-_\s]*mail|почта|email/i;
  const phonePattern = /телефон|phone|mobile|мобильн/i;
  const telegramPattern = /telegram|телеграм|tg|username/i;
  const aboutPattern = /о\s*себе|сопровод|about|cover|message|комментар/i;
  const vacancyPathPattern = /\/(?:vacanc(?:y|ies)|job|jobs|position|positions)\/[^/]+/i;

  function visibleControls() {
    return [...document.querySelectorAll("input, textarea, [contenteditable='true']")].filter((element) => {
      const input = element;
      return !input.disabled && input.type !== "hidden" && input.offsetParent !== null;
    });
  }

  function controlNearLabel(pattern, root = document) {
    for (const label of root.querySelectorAll("label")) {
      if (!pattern.test(label.textContent || "")) continue;
      if (label.control) return label.control;
      const nested = label.querySelector("input, textarea, [contenteditable='true']");
      if (nested) return nested;
      const sibling = label.parentElement?.querySelector("input, textarea, [contenteditable='true']");
      if (sibling) return sibling;
    }
    return null;
  }

  function controlByAttributes(pattern, root = document) {
    return [...root.querySelectorAll("input, textarea, [contenteditable='true']")].find((element) => pattern.test([element.name, element.id, element.placeholder, element.getAttribute("aria-label"), element.autocomplete].filter(Boolean).join(" "))) || null;
  }

  function formRoot() {
    const forms = [...document.querySelectorAll("form")];
    return forms.find((form) => form.querySelector("input[type='file']")) || forms.find((form) => form.querySelector("input[type='email'], textarea")) || document;
  }

  function setValue(element, value) {
    if (!element || value === undefined || value === null || !String(value).trim()) return false;
    const stringValue = String(value).trim();
    if (element.isContentEditable) {
      element.textContent = stringValue;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, stringValue);
      else element.value = stringValue;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function splitName(fullName) {
    const words = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return { firstName: words[0] || "", lastName: "" };
    return { firstName: words[1], lastName: words[0] };
  }

  function attachFile(input, bytes, fileName, type) {
    if (!input) return { ok: false, reason: "на странице не найдено поле для файла" };
    if (!bytes) return { ok: false, reason: "расширение не получило файл с jobs.dev" };
    let transfer;
    let eventSent = false;
    try {
      const file = new File([bytes], fileName || "resume.pdf", { type: type || "application/pdf" });
      transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      eventSent = true;
    } catch {
      // Some frameworks reject the files setter; try their drop handler below.
    }
    if (input.files?.length > 0) return { ok: true, verified: true };
    try {
      const dropTarget = input.closest("label, [role='button'], .upload, .file-upload") || input.parentElement;
      if (!dropTarget || !transfer) return eventSent ? { ok: true, verified: false } : { ok: false, reason: "страница не приняла файл" };
      const EventConstructor = typeof DragEvent === "function" ? DragEvent : Event;
      for (const eventName of ["dragenter", "dragover", "drop"]) {
        const event = new EventConstructor(eventName, { bubbles: true, cancelable: true });
        if ("dataTransfer" in event) Object.defineProperty(event, "dataTransfer", { value: transfer });
        dropTarget.dispatchEvent(event);
      }
      eventSent = true;
      return input.files?.length > 0 ? { ok: true, verified: true } : { ok: true, verified: false };
    } catch {
      return eventSent ? { ok: true, verified: false } : { ok: false, reason: "страница не приняла файл" };
    }
  }

  async function loadFile(requestId) {
    if (!requestId) return null;
    const meta = await browser.runtime.sendMessage({ type: "file-meta", requestId });
    if (!meta?.ok) return null;
    const bytes = new Uint8Array(meta.size);
    const chunks = Math.ceil(meta.size / meta.chunkSize);
    try {
      for (let index = 0; index < chunks; index += 1) {
        const chunk = await browser.runtime.sendMessage({ type: "file-chunk", requestId, index });
        if (!chunk?.ok) return null;
        bytes.set(new Uint8Array(chunk.bytes), index * meta.chunkSize);
      }
      return { bytes, fileName: meta.fileName, type: meta.type };
    } finally {
      await browser.runtime.sendMessage({ type: "release-file", requestId }).catch(() => undefined);
    }
  }

  function showPanel(message, success = true) {
    const host = document.createElement("section");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;right:18px;top:18px;z-index:2147483647;width:310px;background:#0e1018;border:1px solid rgba(51,255,119,.35);border-radius:4px;color:#e8eaf0;font:12px/1.45 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{all:initial}section{padding:14px 16px}strong{display:block;margin-bottom:5px;color:${success ? "#33ff77" : "#ff3e78"};font:12px "Courier New",monospace}p{margin:0;color:#b0b6c4;font:12px Arial,sans-serif}button{margin-top:10px;padding:6px 9px;border:1px solid rgba(58,64,79,.7);border-radius:3px;background:transparent;color:#7d8494;cursor:pointer;font:11px "Courier New",monospace}button:hover{color:#e8eaf0;border-color:#33ff77}</style><section><strong>${success ? "// jobs.dev" : "// ошибка"}</strong><p>${message}</p><button type="button">закрыть</button></section>`;
    shadow.querySelector("button").addEventListener("click", () => host.remove());
    document.body.append(host);
    window.setTimeout(() => host.remove(), 9000);
  }

  function likelyVacancyPage() {
    return vacancyPathPattern.test(location.pathname);
  }

  function showAutofillOffer() {
    if (!likelyVacancyPage() || document.querySelector("[data-jobs-dev-offer='true']")) return;
    const host = document.createElement("section");
    host.dataset.jobsDevOffer = "true";
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:330px;background:#0e1018;border:1px solid rgba(51,255,119,.4);border-radius:4px;color:#e8eaf0;font:12px/1.45 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{all:initial}section{padding:14px 16px}strong{display:block;margin-bottom:5px;color:#33ff77;font:12px "Courier New",monospace}p{margin:0;color:#b0b6c4;font:12px Arial,sans-serif}button{margin-top:10px;padding:8px 10px;border:1px solid rgba(51,255,119,.5);border-radius:3px;background:#33ff77;color:#07080e;cursor:pointer;font:11px "Courier New",monospace}button.secondary{margin-left:8px;border-color:rgba(58,64,79,.7);background:transparent;color:#7d8494}button:disabled{cursor:wait;opacity:.5}button:focus-visible{outline:2px solid #00d4ff;outline-offset:2px}</style><section><strong>// jobs.dev</strong><p>Похоже, это страница вакансии. Заполнить форму данными активного резюме?</p><button class="accept" type="button">заполнить из jobs.dev →</button><button class="secondary close" type="button">не сейчас</button></section>`;
    document.body.append(host);
    const accept = shadow.querySelector(".accept");
    const close = shadow.querySelector(".close");
    close.addEventListener("click", () => host.remove());
    accept.addEventListener("click", async () => {
      accept.disabled = true;
      accept.textContent = "получаем резюме...";
      const result = await autofillFromOffer();
      if (!result.ok) {
        accept.disabled = false;
        accept.textContent = "повторить заполнение →";
        showPanel(result.error, false);
        return;
      }
      host.remove();
    });
  }

  async function autofillFromOffer() {
    const accountResponse = await browser.runtime.sendMessage({ type: "get-account" });
    if (!accountResponse?.ok) return { ok: false, error: accountResponse?.error || "Не удалось загрузить профиль jobs.dev" };
    const account = accountResponse.account;
    const resumes = account?.resumes?.length ? account.resumes : account?.resume ? [account.resume] : [];
    const resume = account?.resume || resumes.find((item) => item.isActive) || resumes[0];
    if (!resume) return { ok: false, error: "В профиле jobs.dev пока нет резюме" };
    const preparedFile = await browser.runtime.sendMessage({ type: "prepare-file", resumeId: resume.id, source: resume.source, hasFile: resume.hasFile, fileName: resume.fileName });
    const response = await fillResume({
      type: "fill-resume",
      resume,
      coverLetter: account.coverLetter || "",
      fileRequestId: preparedFile?.ok ? preparedFile.requestId : null,
      fileError: preparedFile?.error || "",
    });
    return { ok: !response?.message?.includes("Не найдено:") || !response.message.includes("файл резюме"), error: response?.message };
  }

  async function fillResume(message) {
    const resume = message.resume || {};
    const name = splitName(resume.fullName);
    const root = formRoot();
    const controls = visibleControls().filter((element) => root === document || root.contains(element));
    const textInputs = controls.filter((element) => element.tagName === "INPUT" && (!element.type || element.type === "text"));
    const first = controlNearLabel(firstNamePattern, root) || controlByAttributes(firstNamePattern, root) || textInputs[0];
    const last = controlNearLabel(lastNamePattern, root) || controlByAttributes(lastNamePattern, root) || textInputs[1];
    const email = controlNearLabel(emailPattern, root) || controlByAttributes(emailPattern, root) || controls.find((element) => element.type === "email");
    const phone = controlNearLabel(phonePattern, root) || controlByAttributes(phonePattern, root) || controls.find((element) => element.type === "tel");
    const telegram = controlNearLabel(telegramPattern, root) || controlByAttributes(telegramPattern, root);
    const about = controlNearLabel(aboutPattern, root) || controlByAttributes(aboutPattern, root) || controls.find((element) => element.tagName === "TEXTAREA" || element.isContentEditable);
    const fileInput = root.querySelector("input[type='file']") || document.querySelector("input[type='file']");
    const storedFile = await loadFile(message.fileRequestId);
    const filled = [setValue(first, name.firstName), setValue(last, name.lastName), setValue(email, resume.contactEmail), setValue(phone, resume.contactPhone), setValue(telegram, resume.contactTelegram), setValue(about, message.coverLetter)].filter(Boolean).length;
    const attachment = attachFile(fileInput, storedFile?.bytes, storedFile?.fileName || resume.fileName, storedFile?.type || (/\.docx$/i.test(resume.fileName || "") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf"));
    const attached = attachment.ok;
    const total = [first, last, email, phone, telegram, about].filter(Boolean).length + (fileInput ? 1 : 0);
    const missing = [];
    if (!first) missing.push("имя");
    if (!last) missing.push("фамилия");
    if (!email) missing.push("email");
    if (!about) missing.push("о себе");
    if (fileInput && !attached) missing.push(`файл резюме (${message.fileError || attachment.reason})`);
    const fileNotice = attached && !attachment.verified ? " Файл передан форме — проверь, что он отображается в загрузчике." : "";
    const messageText = `Заполнено полей: ${filled + (attached ? 1 : 0)} из ${total}.${missing.length ? ` Не найдено: ${missing.join(", ")}.` : `${fileNotice} Проверь данные и нажми «Отправить заявку».`}`;
    showPanel(messageText, !missing.length);
    return { message: messageText };
  }

  browser.runtime.onMessage.addListener(async (message) => {
    if (message?.type !== "fill-resume") return undefined;
    return fillResume(message);
  });

  if (likelyVacancyPage()) window.setTimeout(showAutofillOffer, 700);
})();
