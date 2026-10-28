/* PacketBridge — Phase 3 report-details form.
   Collects everything the VR2868 + VR2902s need that does NOT come from the
   referral packet: the provider profile (entered once, kept on this device),
   per-packet report details, the session log, and the VR2902 subjects.
   Drafts save/load as a local JSON file — nothing is uploaded anywhere.

   Structure: a pure-logic core (window.PacketBridgeDetails, also require()-able
   for tests) plus a DOM layer that only activates in a browser. */
(function (global) {
  "use strict";

  var SUBJECTS_ALL = ["Screen Reader", "Microsoft Windows", "Microsoft Word",
    "Microsoft Excel", "Microsoft Outlook", "Microsoft PowerPoint",
    "Internet", "Email", "Keyboard Knowledge"];
  var MAX_SESSIONS = 14; /* the VR2868 has exactly 14 service rows */
  var PROFILE_KEY = "packetbridge.profile.v1";

  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function blankProfile() {
    return { providerName: "", street: "", city: "", state: "", zip: "",
      phone: "", fax: "", email: "", trainer: "" };
  }

  function blankSession() { return { date: "", hours: "", description: "" }; }

  /* Prefill from the extracted record: subjects come from the 1884 topics
     (Keyboard Knowledge is NOT auto-checked — Fernando's rule: the 1884
     decides, and the form offers it as an extra unticked option). */
  function blankDetails(record) {
    var subjects = [];
    if (record && record.derived && record.derived.subjects2902) {
      subjects = record.derived.subjects2902.slice();
    }
    return {
      mode: "prep", /* "prep" = ratings blank | "complete" = ratings entered */
      reportDate: todayISO(),
      assessmentDate: "",
      sessions: [blankSession()],
      problems: "",
      effectiveness: "",
      additionalNeeds: "",
      followUp: "", /* "" | "Short" | "Long" — VR2868 follow-up period radio */
      subjects: subjects
    };
  }

  function validateDetails(d) {
    var warnings = [];
    if (!d) return ["No details yet."];
    if (d.sessions.length > MAX_SESSIONS)
      warnings.push("The VR2868 fits " + MAX_SESSIONS + " sessions; this draft has " + d.sessions.length + ".");
    d.sessions.forEach(function (s, i) {
      var any = s.date || s.hours || s.description;
      if (any && !s.date) warnings.push("Session " + (i + 1) + " has no date.");
      if (any && !s.hours) warnings.push("Session " + (i + 1) + " has no hours.");
    });
    if (!d.subjects.length)
      warnings.push("No VR2902 subjects selected — the generated packet will have no assessments.");
    return warnings;
  }

  function serializeDraft(details, record) {
    return JSON.stringify({
      app: "PacketBridge", kind: "draft", version: 1,
      savedAt: new Date().toISOString(),
      packet: record ? {
        customer: record.customer ? record.customer.name : null,
        saNumber: record.authorization ? record.authorization.number : null,
        caseId: record.authorization ? record.authorization.caseId : null
      } : null,
      details: details
    }, null, 2);
  }

  function parseDraft(text) {
    var obj = JSON.parse(text);
    if (!obj || obj.app !== "PacketBridge" || obj.kind !== "draft" || !obj.details)
      throw new Error("That file is not a PacketBridge draft.");
    var d = obj.details;
    /* Defensive defaults so an older/hand-edited draft cannot break the form. */
    var base = blankDetails(null);
    Object.keys(base).forEach(function (k) { if (d[k] === undefined) d[k] = base[k]; });
    if (!Array.isArray(d.sessions) || !d.sessions.length) d.sessions = [blankSession()];
    if (!Array.isArray(d.subjects)) d.subjects = [];
    return obj;
  }

  var logic = {
    SUBJECTS_ALL: SUBJECTS_ALL, MAX_SESSIONS: MAX_SESSIONS, PROFILE_KEY: PROFILE_KEY,
    todayISO: todayISO, blankProfile: blankProfile, blankSession: blankSession,
    blankDetails: blankDetails, validateDetails: validateDetails,
    serializeDraft: serializeDraft, parseDraft: parseDraft
  };
  if (typeof module !== "undefined" && module.exports) module.exports = logic;
  global.PacketBridgeDetails = logic;

  /* ---------------- DOM layer (browser only) ---------------- */
  if (typeof document === "undefined") return;

  var els = {};
  var currentRecord = null;

  function $(id) { return document.getElementById(id); }
  function field(labelText, input) {
    var wrap = document.createElement("div");
    wrap.className = "fld";
    var lab = document.createElement("label");
    lab.textContent = labelText;
    lab.htmlFor = input.id;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function textInput(id, type) {
    var i = document.createElement("input");
    i.type = type || "text"; i.id = id;
    return i;
  }

  /* ---- profile ---- */
  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      if (raw) { var p = blankProfile(); var saved = JSON.parse(raw); Object.keys(p).forEach(function (k) { if (saved[k] !== undefined) p[k] = saved[k]; }); return p; }
    } catch (e) { /* storage unavailable (some file:// setups) — form still works, just doesn't persist */ }
    return blankProfile();
  }
  function saveProfile() {
    var p = collectProfile();
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* see loadProfile note */ }
    return p;
  }
  function collectProfile() {
    var p = blankProfile();
    Object.keys(p).forEach(function (k) { var el = $("pf-" + k); if (el) p[k] = el.value.trim(); });
    return p;
  }
  function fillProfile(p) {
    Object.keys(blankProfile()).forEach(function (k) { var el = $("pf-" + k); if (el) el.value = p[k] || ""; });
  }

  function buildProfileForm() {
    var host = $("profile-fields");
    if (!host || host.childNodes.length) return;
    var defs = [
      ["providerName", "Provider / company name"], ["street", "Street address"],
      ["city", "City"], ["state", "State"], ["zip", "ZIP code"],
      ["phone", "Phone"], ["fax", "Fax"], ["email", "Email"], ["trainer", "Trainer name"]
    ];
    defs.forEach(function (d) {
      var input = textInput("pf-" + d[0], d[0] === "email" ? "email" : "text");
      input.addEventListener("change", saveProfile);
      host.appendChild(field(d[1], input));
    });
    fillProfile(loadProfile());
  }

  /* ---- sessions ---- */
  function sessionRow(s, idx) {
    var fs = document.createElement("fieldset");
    fs.className = "session-row";
    var legend = document.createElement("legend");
    legend.textContent = "Session " + (idx + 1);
    fs.appendChild(legend);
    var date = textInput("", "date"); date.value = s.date || ""; date.dataset.role = "date";
    date.setAttribute("aria-label", "Session " + (idx + 1) + " date");
    var hours = textInput("", "number"); hours.min = "0"; hours.step = "0.25"; hours.value = s.hours || ""; hours.dataset.role = "hours";
    hours.setAttribute("aria-label", "Session " + (idx + 1) + " hours");
    var desc = textInput(""); desc.value = s.description || ""; desc.dataset.role = "description";
    desc.setAttribute("aria-label", "Session " + (idx + 1) + " description");
    fs.appendChild(field("Date", date));
    fs.appendChild(field("Hours", hours));
    fs.appendChild(field("What was done", desc));
    var rm = document.createElement("button");
    rm.type = "button"; rm.textContent = "Remove session " + (idx + 1);
    rm.addEventListener("click", function () {
      var list = collectSessions();
      list.splice(idx, 1);
      renderSessions(list.length ? list : [blankSession()]);
    });
    fs.appendChild(rm);
    return fs;
  }
  function renderSessions(sessions) {
    var host = $("sessions-list");
    host.innerHTML = "";
    sessions.forEach(function (s, i) { host.appendChild(sessionRow(s, i)); });
  }
  function collectSessions() {
    var out = [];
    var rows = $("sessions-list").querySelectorAll(".session-row");
    rows.forEach(function (row) {
      out.push({
        date: row.querySelector('[data-role="date"]').value,
        hours: row.querySelector('[data-role="hours"]').value,
        description: row.querySelector('[data-role="description"]').value.trim()
      });
    });
    return out;
  }

  /* ---- whole form ---- */
  function collectDetails() {
    var subjects = [];
    SUBJECTS_ALL.forEach(function (s) {
      var cb = $("subj-" + s.replace(/\s+/g, "-"));
      if (cb && cb.checked) subjects.push(s);
    });
    return {
      mode: document.querySelector('input[name="pb-mode"]:checked').value,
      reportDate: $("dt-reportDate").value,
      assessmentDate: $("dt-assessmentDate").value,
      sessions: collectSessions(),
      problems: $("dt-problems").value.trim(),
      effectiveness: $("dt-effectiveness").value.trim(),
      additionalNeeds: $("dt-additionalNeeds").value.trim(),
      followUp: $("dt-followUp").value,
      subjects: subjects
    };
  }
  function fillDetails(d) {
    document.querySelector('input[name="pb-mode"][value="' + (d.mode === "complete" ? "complete" : "prep") + '"]').checked = true;
    $("dt-reportDate").value = d.reportDate || "";
    $("dt-assessmentDate").value = d.assessmentDate || "";
    $("dt-problems").value = d.problems || "";
    $("dt-effectiveness").value = d.effectiveness || "";
    $("dt-additionalNeeds").value = d.additionalNeeds || "";
    $("dt-followUp").value = d.followUp || "";
    SUBJECTS_ALL.forEach(function (s) {
      var cb = $("subj-" + s.replace(/\s+/g, "-"));
      if (cb) cb.checked = d.subjects.indexOf(s) >= 0;
    });
    renderSessions(d.sessions && d.sessions.length ? d.sessions : [blankSession()]);
    updateModeNote();
  }
  function updateModeNote() {
    var complete = document.querySelector('input[name="pb-mode"]:checked').value === "complete";
    $("ratings-note").hidden = !complete;
  }
  function setDetailsStatus(msg) { $("details-status").textContent = msg; }

  function buildSubjects() {
    var host = $("subjects-list");
    if (host.childNodes.length) return;
    SUBJECTS_ALL.forEach(function (s) {
      var wrap = document.createElement("div");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = "subj-" + s.replace(/\s+/g, "-");
      var lab = document.createElement("label");
      lab.htmlFor = cb.id; lab.textContent = s;
      wrap.appendChild(cb); wrap.appendChild(lab);
      host.appendChild(wrap);
    });
  }

  function init() {
    buildProfileForm();
    buildSubjects();
    $("add-session").addEventListener("click", function () {
      var list = collectSessions();
      if (list.length >= MAX_SESSIONS) { setDetailsStatus("That's all " + MAX_SESSIONS + " session rows — the VR2868 has no more."); return; }
      list.push(blankSession());
      renderSessions(list);
    });
    document.querySelectorAll('input[name="pb-mode"]').forEach(function (r) {
      r.addEventListener("change", updateModeNote);
    });
    $("save-draft").addEventListener("click", function () {
      var details = collectDetails();
      var json = serializeDraft(details, currentRecord);
      var name = "PacketBridge-draft-" + ((currentRecord && currentRecord.customer && currentRecord.customer.name) || "packet").replace(/\s+/g, "-") + ".json";
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      var w = validateDetails(details);
      setDetailsStatus("Draft saved as " + name + (w.length ? " Heads up: " + w.join(" ") : ""));
      window.PBState = { record: currentRecord, profile: saveProfile(), details: details };
    });
    $("load-draft-btn").addEventListener("click", function () { $("load-draft-file").click(); });
    $("load-draft-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      f.text().then(function (text) {
        try {
          var draft = parseDraft(text);
          fillDetails(draft.details);
          var note = "";
          if (draft.packet && currentRecord && draft.packet.saNumber &&
              currentRecord.authorization && draft.packet.saNumber !== currentRecord.authorization.number)
            note = " Note: this draft was saved for SA " + draft.packet.saNumber + ", which is not the packet currently loaded.";
          setDetailsStatus("Draft loaded." + note);
          window.PBState = { record: currentRecord, profile: collectProfile(), details: draft.details };
        } catch (e) { setDetailsStatus(e.message); }
        this.value = "";
      }.bind(this));
    });
    renderSessions([blankSession()]);
  }

  /* Called by app.js after a packet is read: prefill a fresh details form. */
  function onRecord(record) {
    currentRecord = record;
    $("details-section").hidden = false;
    fillDetails(blankDetails(record));
    setDetailsStatus("Packet loaded — the report form below is prefilled from it. Your profile is kept on this device.");
    window.PBState = { record: record, profile: collectProfile(), details: collectDetails() };
  }

  global.PBDetails = { init: init, onRecord: onRecord, collect: collectDetails, collectProfile: collectProfile };
  document.addEventListener("DOMContentLoaded", init);
})(typeof window !== "undefined" ? window : globalThis);
