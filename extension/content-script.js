(() => {
  const extensionApi = globalThis.browser || globalThis.chrome;
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
    if (!bytes) return { ok: false, reason: "расширение не получило файл с devver" };
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
    const meta = await extensionApi.runtime.sendMessage({ type: "file-meta", requestId });
    if (!meta?.ok) return null;
    const bytes = new Uint8Array(meta.size);
    const chunks = Math.ceil(meta.size / meta.chunkSize);
    try {
      for (let index = 0; index < chunks; index += 1) {
        const chunk = await extensionApi.runtime.sendMessage({ type: "file-chunk", requestId, index });
        if (!chunk?.ok) return null;
        bytes.set(new Uint8Array(chunk.bytes), index * meta.chunkSize);
      }
      return { bytes, fileName: meta.fileName, type: meta.type };
    } finally {
      await extensionApi.runtime.sendMessage({ type: "release-file", requestId }).catch(() => undefined);
    }
  }

  function showPanel(message, success = true) {
    const host = document.createElement("section");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;right:18px;top:18px;z-index:2147483647;width:310px;background:#0e1018;border:1px solid rgba(51,255,119,.35);border-radius:4px;color:#e8eaf0;font:12px/1.45 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>:host{all:initial}section{padding:14px 16px}strong{display:block;margin-bottom:5px;color:${success ? "#33ff77" : "#ff3e78"};font:12px "Courier New",monospace}p{margin:0;color:#b0b6c4;font:12px Arial,sans-serif}button{margin-top:10px;padding:6px 9px;border:1px solid rgba(58,64,79,.7);border-radius:3px;background:transparent;color:#7d8494;cursor:pointer;font:11px "Courier New",monospace}button:hover{color:#e8eaf0;border-color:#33ff77}</style><section><strong>${success ? "// devver" : "// ошибка"}</strong><p>${message}</p><button type="button">закрыть</button></section>`;
    shadow.querySelector("button").addEventListener("click", () => host.remove());
    document.body.append(host);
    window.setTimeout(() => host.remove(), 9000);
  }

  function likelyVacancyPage() {
    return vacancyPathPattern.test(location.pathname);
  }

  function postingMetadata() {
    let jsonLd = [];
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const value = JSON.parse(node.textContent || "null");
        jsonLd.push(...(Array.isArray(value) ? value : [value]));
      } catch {
        // A broken JSON-LD block should not prevent form filling.
      }
    }
    const posting = jsonLd.find((item) => item?.["@type"] === "JobPosting") || {};
    const title = String(posting.title || document.querySelector("h1")?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title || "").replace(/\s+/g, " ").trim();
    const company = String(posting.hiringOrganization?.name || document.querySelector('meta[property="og:site_name"]')?.content || "").replace(/\s+/g, " ").trim();
    return { pageUrl: location.href, title, company };
  }

  let lastTrackedSubmission = "";
  async function trackSubmittedApplication({ testOnly = false } = {}) {
    if (!likelyVacancyPage()) return { ok: false, error: "Это не страница вакансии" };
    const metadata = postingMetadata();
    const fingerprint = metadata.pageUrl + "|" + metadata.title;
    if (!testOnly && fingerprint === lastTrackedSubmission) return { ok: true, duplicate: true };
    if (!testOnly) lastTrackedSubmission = fingerprint;
    const result = await extensionApi.runtime.sendMessage({ type: "track-application", ...metadata, submittedAt: new Date().toISOString() });
    if (!result?.ok) {
      const message = result?.error || "Отклик отправлен, но не удалось сохранить его в devver.";
      if (!testOnly) showPanel(message, false);
      return { ok: false, error: message };
    }
    if (result.matched) {
      showPanel((testOnly ? "Тестовый отклик отмечен в devver: «" : "Отклик сохранён в devver: «") + (result.application?.title || metadata.title) + "». Открой раздел «Активность», чтобы отслеживать статус.");
    } else {
      const message = result.message || "Вакансия не найдена в каталоге devver — добавь её вручную.";
      showPanel(testOnly ? "Тестовый отклик не сохранён: " + message : "Отклик отправлен. " + message, false);
    }
    return { ok: true, matched: Boolean(result.matched), application: result.application };
  }

  function watchSubmission() {
    document.addEventListener("submit", () => { window.setTimeout(() => void trackSubmittedApplication(), 500); }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button, input[type='submit'], [role='button']") : null;
      if (!target) return;
      if (target.closest("[data-jobs-dev-test-application='true']")) return;
      const label = (target.textContent || "") + " " + (target.getAttribute("aria-label") || "") + " " + (target.getAttribute("value") || "");
      if (/отправ|submit|apply|отклик|кандидат/i.test(label)) window.setTimeout(() => void trackSubmittedApplication(), 1200);
    }, true);
  }

  async function showAutofillOffer() {
    if (!likelyVacancyPage() || document.querySelector("[data-jobs-dev-offer='true']")) return;
    const accountResponse = await extensionApi.runtime.sendMessage({ type: "get-account" });
    if (!accountResponse?.ok) return;
    const account = accountResponse.account;
    const resumes = account?.resumes?.length ? account.resumes : account?.resume ? [account.resume] : [];
    if (!(account?.resume || resumes.find((item) => item.isActive) || resumes[0])) return;
    const host = document.createElement("section");
    host.dataset.jobsDevOffer = "true";
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:330px;background:#0e1018;border:1px solid rgba(51,255,119,.4);border-radius:4px;color:#e8eaf0;font:12px/1.45 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    const shadow = host.attachShadow({ mode: "open" });
    const activeResumeId = String(account.resume?.id || resumes.find((item) => item.isActive)?.id || "");
    const resumeOptions = resumes.map((resume) => `<option value="${String(resume.id).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"${String(resume.id) === activeResumeId ? " selected" : ""}>${String(resume.position || resume.fileName || "Резюме").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</option>`).join("");
    const resumePicker = resumes.length > 1 ? `<label class="resume-label" for="jobs-dev-resume-choice">резюме для заполнения</label><select id="jobs-dev-resume-choice" class="resume-choice">${resumeOptions}</select>` : "";
    shadow.innerHTML = `<style>:host{all:initial}section{padding:14px 16px}strong{display:block;margin-bottom:5px;color:#33ff77;font:12px "Courier New",monospace}p{margin:0;color:#b0b6c4;font:12px Arial,sans-serif}.resume-label{display:block;margin-top:10px;color:#7d8494;font:10px "Courier New",monospace;text-transform:uppercase;letter-spacing:.06em}.resume-choice{display:block;width:100%;margin-top:4px;padding:7px 8px;border:1px solid rgba(58,64,79,.7);border-radius:3px;background:#07080e;color:#e8eaf0;font:11px "Courier New",monospace}button{display:block;margin-top:10px;padding:8px 10px;border:1px solid rgba(51,255,119,.5);border-radius:3px;background:#33ff77;color:#07080e;cursor:pointer;font:11px "Courier New",monospace}button.test-apply{border-color:rgba(0,212,255,.45);background:transparent;color:#00d4ff}button.secondary{display:inline-block;margin-left:8px;border-color:rgba(58,64,79,.7);background:transparent;color:#7d8494}button:disabled{cursor:wait;opacity:.5}button:focus-visible,select:focus-visible{outline:2px solid #00d4ff;outline-offset:2px}</style><section><strong>// devver</strong><p>${resumes.length > 1 ? `В профиле ${resumes.length} резюме. Выбери, чем заполнить форму.` : "Похоже, это страница вакансии. Заполнить форму данными активного резюме?"}</p>${resumePicker}<button class="accept" type="button">заполнить из devver →</button><button class="test-apply" data-jobs-dev-test-application="true" type="button">тест: отметить отклик (без отправки)</button><button class="secondary close" type="button">не сейчас</button></section>`;
    document.body.append(host);
    const accept = shadow.querySelector(".accept");
    const testApply = shadow.querySelector(".test-apply");
    const close = shadow.querySelector(".close");
    close.addEventListener("click", () => host.remove());
    accept.addEventListener("click", async () => {
      accept.disabled = true;
      accept.textContent = "получаем резюме...";
      const choice = shadow.querySelector(".resume-choice");
      const result = await autofillFromOffer(account, choice?.value || "");
      if (!result.ok) {
        accept.disabled = false;
        accept.textContent = "повторить заполнение →";
        showPanel(result.error, false);
        return;
      }
      host.remove();
    });
    testApply.addEventListener("click", async () => {
      testApply.disabled = true;
      testApply.textContent = "проверяем вакансию...";
      const result = await trackSubmittedApplication({ testOnly: true });
      if (!result.ok) {
        testApply.disabled = false;
        testApply.textContent = "повторить тестовый отклик";
        return;
      }
      testApply.textContent = result.matched ? "отмечено в активности" : "вакансия не найдена";
    });
  }

  async function autofillFromOffer(account, requestedResumeId = "") {
    const resumes = account?.resumes?.length ? account.resumes : account?.resume ? [account.resume] : [];
    const resume = resumes.find((item) => String(item.id) === String(requestedResumeId)) || account?.resume || resumes.find((item) => item.isActive) || resumes[0];
    if (!resume) return { ok: false, error: "В профиле devver пока нет резюме" };
    const preparedFile = await extensionApi.runtime.sendMessage({ type: "prepare-file", resumeId: resume.id, source: resume.source, hasFile: resume.hasFile, fileName: resume.fileName });
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

  extensionApi.runtime.onMessage.addListener(async (message) => {
    if (message?.type !== "fill-resume") return undefined;
    return fillResume(message);
  });

  if (likelyVacancyPage()) {
    window.setTimeout(showAutofillOffer, 700);
    watchSubmission();
  }
})();
