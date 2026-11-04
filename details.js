/* PacketBridge — Phase 3 report-details form.
   Collects everything the VR2868 + VR2902s need that does NOT come from the
   referral packet: the provider profile (entered once, kept on this device),
   per-packet report details, the session log, and the VR2902 subjects.
   Drafts save/load as a local JSON file — nothing is uploaded anywhere.

   Structure: a pure-logic core (window.PacketBridgeDetails, also require()-able
   for tests) plus a DOM layer that only activates in a browser. */
(function (global) {
  "use strict";

  var SUBJECTS_ALL = ["Screen Reader", "Screen Magnification", "Microsoft Windows",
    "Microsoft Word", "Microsoft Excel", "Internet", "Notetaker",
    "Optical Character Recognition", "Keyboard Knowledge"];
  /* ^ The subjects that exist on the VR2902 (checkbox + task section), in
     canonical form. Locked to tasks-data.js and generate.js by
     test/test-subjects.js — the extractor must emit exactly these names.
     (Email / Outlook / PowerPoint are 1884 training topics but have no
     VR2902 subject; they surface as notes, not checkboxes.) */
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
    /* No subjects from the 1884 (usually: no 1884 loaded) — fall back to
       the EAS-derived suggestions so the baseline form still opens with a
       useful pre-check. The readout labels them as suggestions. */
    if (!subjects.length && record && record.derived && record.derived.suggestedSubjects) {
      subjects = record.derived.suggestedSubjects.map(function (s) { return s.subject; });
    }
    return {
      reportDate: todayISO(),
      assessmentDate: "",
      postAssessmentDate: "",
      sessions: [blankSession()],
      problems: "",
      effectiveness: "",
      equipmentUsed: "", /* VR2868 "Equipment Used in This Training Session" — what the TRAINER used, entered by hand; never copied from the customer's own hardware */
      softwareUsed: "",
      additionalNeeds: "",
      followUp: "", /* "" | "Short" | "Long" — VR2868 follow-up period radio */
      subjects: subjects,
      /* Trainer-confirmed prerequisites — confirmed by hand in the form,
         never extracted from the packet (Fernando, 2026-11-02). */
      prereqs: { baselineCopyReceived: false },
      ratings: { baseline: {}, post: {} } /* field name -> "0"|"1"|"2" (WPM fields: free text) */
    };
  }

  /* The VR2902 scale is the form's own: 0/1/2 per task, score = the sum. */
  function scoreForGroup(ratingsObj, group) {
    var sum = 0, rated = 0;
    group.tasks.forEach(function (t) {
      var v = ratingsObj ? ratingsObj[t.field] : undefined;
      if (v === "0" || v === "1" || v === "2") { sum += parseInt(v, 10); rated++; }
    });
    return { sum: rated ? sum : null, rated: rated, total: group.tasks.length, max: group.tasks.length * 2 };
  }

  function computeScores(ratingsObj, sections) {
    var out = {};
    (sections || []).forEach(function (s) {
      s.groups.forEach(function (g) { out[g.scoreField] = scoreForGroup(ratingsObj, g); });
    });
    return out;
  }

  function sectionForSubject(sections, subject) {
    var found = null;
    (sections || []).forEach(function (s) { if (s.subject === subject) found = s; });
    return found;
  }

  /* Plain-language note shown above the subjects checkboxes, so the
     pre-checked list never looks like something the trainer typed or a
     default everyone gets (Fernando, 2026-11-04: he loaded a packet,
     saw the baseline subjects already filled, and could not tell the
     program had pulled them). Says WHERE the checks came from and that
     the same list drives both VR2902s. */
  function subjectsPrefillNote(record) {
    var from1884 = (record && record.derived && record.derived.subjects2902) || [];
    if (from1884.length) {
      return "Auto-filled from the VR1884 — you did not type these. When you loaded the packet, " +
        "PacketBridge read the referral's training topics and checked the matching VR2902 subjects " +
        "(for example, a Fusion topic checks Screen Reader and Screen Magnification). " +
        "This same list is used for both the baseline and the post-training VR2902. " +
        "Review it before you generate: uncheck anything that should not be assessed, and check anything that is missing.";
    }
    var sugg = (record && record.derived && record.derived.suggestedSubjects) || [];
    if (sugg.length) {
      return "Auto-filled from the EAS — you did not type these. No VR1884 training topics were found, " +
        "so the checked subjects are suggestions drawn from the EAS recommendations. " +
        "This same list is used for both the baseline and the post-training VR2902. " +
        "Review it carefully before you generate: uncheck anything that should not be assessed, and check anything that is missing.";
    }
    return "Nothing was auto-filled. Check the subjects to assess — the same list is used for both the baseline and the post-training VR2902.";
  }

  function validateDetails(d, sections, record) {
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
    /* Teach only what is authorized (referral-review checklist §6): a
       selected VR2902 subject the packet does not call for gets a warning.
       The packet's subjects are the 1884-derived ones; when the packet
       derived none (usually no 1884), the EAS suggestions stand in. */
    if (record && record.derived) {
      var allowedSubj = {};
      (record.derived.subjects2902 || []).forEach(function (x) { allowedSubj[x] = true; });
      if (!Object.keys(allowedSubj).length)
        (record.derived.suggestedSubjects || []).forEach(function (x) { allowedSubj[x.subject] = true; });
      if (Object.keys(allowedSubj).length) {
        d.subjects.forEach(function (subj) {
          if (!allowedSubj[subj])
            warnings.push(subj + " is selected, but this packet does not call for it — the packet calls for: " +
              Object.keys(allowedSubj).join(", ") + ". Assess only authorized subjects; if the counselor authorized " +
              subj + " another way, ignore this warning.");
        });
      }
    }
    /* Authorized-limits guard (Fernando, 2026-11-02): planned session
       hours are totaled against the SA's authorized training hours, and
       session dates are checked against the SA window. Warnings, not
       blocks — the trainer may know something the packet doesn't say. */
    if (record && record.authorization && record.derived) {
      var guardTripped = false;
      var totalHours = 0;
      d.sessions.forEach(function (s) { var h = parseFloat(s.hours); if (!isNaN(h)) totalHours += h; });
      var saH = record.derived.saHours || {};
      var authorized = saH.training > 0 ? saH.training : (saH.allHours || 0);
      function trimNum(n) { return Math.round(n * 100) / 100; }
      if (authorized > 0 && totalHours > authorized) {
        guardTripped = true;
        warnings.push("Sessions total " + trimNum(totalHours) + " hours, but the SA authorizes " + trimNum(authorized) +
          " hours of training — " + trimNum(totalHours - authorized) + " hours over the authorized limit.");
      }
      function mdyToISO(v) {
        var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || ""));
        if (!m) return null;
        function pp(x) { return (x.length < 2 ? "0" : "") + x; }
        return m[3] + "-" + pp(m[1]) + "-" + pp(m[2]);
      }
      var winStart = mdyToISO(record.authorization.startDate);
      var winEnd = mdyToISO(record.authorization.endDate);
      if (winStart || winEnd) {
        d.sessions.forEach(function (s, i) {
          if (s.date && ((winStart && s.date < winStart) || (winEnd && s.date > winEnd))) {
            guardTripped = true;
            warnings.push("Session " + (i + 1) + " is dated " + s.date + ", outside the SA window (" +
              (record.authorization.startDate || "…") + " to " + (record.authorization.endDate || "…") + ").");
          }
        });
      }
      /* The actionable route for an authorization problem (checklist §4):
         it is fixed by amending the SA, and amendments belong to the
         issuer — say so wherever the guard warning surfaces. */
      if (guardTripped)
        warnings.push("Authorization problems like these are fixed with an SA amendment — ask the SA issuer (the TWC contact named on the SA) to amend the authorized hours or dates.");
    }
    /* Sequence checks the gated flow makes possible (2026-11-03): a
       subject rated in NEITHER phase generates as an unrated prep
       subject (worth flagging), and post ratings with no baseline break
       the assessment order — a post score without a baseline has nothing
       to compare against. */
    if (sections) {
      d.subjects.forEach(function (subj) {
        var sec = sectionForSubject(sections, subj);
        if (!sec) return;
        var anyBase = false, anyPost = false;
        sec.groups.forEach(function (g) {
          g.tasks.forEach(function (t) {
            if (d.ratings.baseline && d.ratings.baseline[t.field]) anyBase = true;
            if (d.ratings.post && d.ratings.post[t.field]) anyPost = true;
          });
        });
        if (!anyBase && !anyPost)
          warnings.push(subj + " is selected but has no ratings in either assessment — it will be generated as an unrated subject.");
        else if (anyPost && !anyBase)
          warnings.push(subj + " has post-training ratings but no baseline ratings — the baseline is assessed first; a post-training score without a baseline has nothing to compare against.");
      });
      if (d.assessmentDate && d.postAssessmentDate && d.postAssessmentDate < d.assessmentDate)
        warnings.push("The post-training assessment date (" + d.postAssessmentDate + ") is before the baseline assessment date (" + d.assessmentDate + ") — the post-training assessment happens after the baseline.");
    }
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
    /* Only the baseline-copy confirmation survives from the old
       prerequisites (2026-11-03): the rest is read from the packet as
       sequence evidence. Older drafts may carry the dropped keys; they
       are ignored. */
    d.prereqs = { baselineCopyReceived: !!((d.prereqs || {}).baselineCopyReceived) };
    return obj;
  }

  var logic = {
    SUBJECTS_ALL: SUBJECTS_ALL, MAX_SESSIONS: MAX_SESSIONS, PROFILE_KEY: PROFILE_KEY,
    todayISO: todayISO, blankProfile: blankProfile, blankSession: blankSession,
    blankDetails: blankDetails, validateDetails: validateDetails,
    subjectsPrefillNote: subjectsPrefillNote,
    serializeDraft: serializeDraft, parseDraft: parseDraft,
    scoreForGroup: scoreForGroup, computeScores: computeScores, sectionForSubject: sectionForSubject
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
      setDetailsStatus("Session " + (idx + 1) + " removed.");
      focusSessionDate(idx);
    });
    fs.appendChild(rm);
    return fs;
  }
  function renderSessions(sessions) {
    var host = $("sessions-list");
    host.innerHTML = "";
    sessions.forEach(function (s, i) { host.appendChild(sessionRow(s, i)); });
  }
  /* renderSessions rebuilds the list, which drops keyboard/screen-reader
     focus to the top of the page. Put focus back on a sensible date field:
     the row that took the removed row's place, or the newly added row. */
  function focusSessionDate(idx) {
    var rows = $("sessions-list").querySelectorAll(".session-row");
    if (!rows.length) return;
    var row = rows[Math.max(0, Math.min(idx, rows.length - 1))];
    var d = row && row.querySelector('[data-role="date"]');
    if (d) d.focus();
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

  /* ---- ratings (Phase 3b) ---- */
  var ratingsState = { baseline: {}, post: {} };
  var selCounter = 0;

  function tasksData() { return (typeof window !== "undefined" && window.PacketBridgeTasks) || null; }

  function scoreText(sc) {
    return sc.sum === null ? "not rated yet" : (sc.sum + " of " + sc.max + " (" + sc.rated + " of " + sc.total + " tasks rated)");
  }

  function refreshScoreSpans() {
    document.querySelectorAll("[data-score-for]").forEach(function (span) {
      var parts = span.getAttribute("data-score-for").split("|");
      var phase = parts[0], subject = parts[1], gi = parseInt(parts[2], 10);
      var sec = sectionForSubject(tasksData() ? tasksData().sections : [], subject);
      if (sec) span.textContent = scoreText(scoreForGroup(ratingsState[phase], sec.groups[gi]));
    });
    /* Baseline echoes beside the post-training controls: what you rated
       this task (and this group) before training, for quick comparison. */
    document.querySelectorAll("[data-baseline-echo]").forEach(function (span) {
      var v = ratingsState.baseline[span.getAttribute("data-baseline-echo")];
      span.textContent = "Baseline: " + (v ? v : "not rated");
    });
    document.querySelectorAll("[data-baseline-score]").forEach(function (span) {
      var parts = span.getAttribute("data-baseline-score").split("|");
      var sec = sectionForSubject(tasksData() ? tasksData().sections : [], parts[0]);
      if (sec) {
        var sc = scoreForGroup(ratingsState.baseline, sec.groups[parseInt(parts[1], 10)]);
        span.textContent = sc.sum === null ? "" : " (baseline score: " + sc.sum + " of " + sc.max + ")";
      }
    });
    document.querySelectorAll("[data-baseline-wpm]").forEach(function (span) {
      var b = ratingsState.baseline;
      var gross = b["Keyboard Speed Gross WPM"], net = b["Keyboard Speed Net WPM"];
      span.textContent = (gross || net) ? "Baseline: Gross " + (gross || "—") + ", Net " + (net || "—") : "";
    });
  }

  function ratingRow(phase, subject, group, groupIdx, task) {
    var row = document.createElement("div");
    row.className = "rating-task";
    var sel = document.createElement("select");
    sel.id = "rate-" + (selCounter++);
    ["", "0", "1", "2"].forEach(function (v) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v === "" ? "Not rated" : v;
      sel.appendChild(o);
    });
    sel.value = ratingsState[phase][task.field] || "";
    var lab = document.createElement("label");
    lab.htmlFor = sel.id;
    lab.textContent = task.n + ". " + task.text;
    sel.addEventListener("change", function () {
      if (sel.value) ratingsState[phase][task.field] = sel.value;
      else delete ratingsState[phase][task.field];
      refreshScoreSpans();
      if (phase === "baseline") renderPostGate();
    });
    row.appendChild(lab);
    row.appendChild(sel);
    if (phase === "post") {
      var echo = document.createElement("span");
      echo.className = "baseline-echo";
      echo.setAttribute("data-baseline-echo", task.field);
      row.appendChild(echo);
    }
    return row;
  }

  function renderPhase(phase, host) {
    var data = tasksData();
    host.innerHTML = "";
    if (!data) {
      var p0 = document.createElement("p");
      p0.textContent = "The VR2902 task lists failed to load, so ratings are unavailable in this copy.";
      host.appendChild(p0);
      return;
    }
    var subjects = collectSubjectsOnly();
    if (!subjects.length) {
      var p1 = document.createElement("p");
      p1.textContent = "Select at least one assessment subject above and its task list will appear here.";
      host.appendChild(p1);
      return;
    }
    subjects.forEach(function (subj) {
      var sec = sectionForSubject(data.sections, subj);
      if (!sec) {
        var note = document.createElement("p");
        note.textContent = subj + ": the VR2902 has no task list for this subject — nothing to rate here.";
        host.appendChild(note);
        return;
      }
      var fs = document.createElement("fieldset");
      fs.className = "rating-phase";
      var legend = document.createElement("legend");
      legend.textContent = subj;
      fs.appendChild(legend);
      sec.groups.forEach(function (g, gi) {
        var glab = document.createElement("p");
        glab.className = "group-label";
        var strong = document.createElement("strong");
        strong.textContent = g.label + " — score: ";
        glab.appendChild(strong);
        var span = document.createElement("span");
        span.setAttribute("data-score-for", phase + "|" + subj + "|" + gi);
        glab.appendChild(span);
        if (phase === "post") {
          var bs = document.createElement("span");
          bs.className = "baseline-echo";
          bs.setAttribute("data-baseline-score", subj + "|" + gi);
          glab.appendChild(bs);
        }
        fs.appendChild(glab);
        g.tasks.forEach(function (t) { fs.appendChild(ratingRow(phase, subj, g, gi, t)); });
      });
      if (subj === "Keyboard Knowledge") {
        data.wpmFields.forEach(function (wf) {
          var inp = textInput("", "number");
          inp.min = "0"; inp.value = ratingsState[phase][wf] || "";
          inp.setAttribute("aria-label", wf);
          inp.addEventListener("change", function () {
            if (inp.value) ratingsState[phase][wf] = inp.value; else delete ratingsState[phase][wf];
            refreshScoreSpans();
            if (phase === "baseline") renderPostGate();
          });
          fs.appendChild(field(wf, inp));
        });
        if (phase === "post") {
          var wpmEcho = document.createElement("p");
          wpmEcho.className = "baseline-echo";
          wpmEcho.setAttribute("data-baseline-wpm", "1");
          fs.appendChild(wpmEcho);
        }
      }
      host.appendChild(fs);
    });
  }

  /* The gated flow (Fernando, 2026-11-03 — point 2): no Prep/Complete
     toggle. The baseline grids are always available once subjects are
     picked; the post-training grids stay locked until the baseline has
     its first rating (or a loaded draft already has post ratings) —
     that is the order the service actually runs. */
  function anyRatings(phase) { return Object.keys(ratingsState[phase] || {}).length > 0; }
  function postUnlocked() { return anyRatings("baseline") || anyRatings("post"); }
  function renderPostGate() {
    var pw = $("ratings-post-wrap"), lock = $("ratings-post-lock"), host = $("ratings-post");
    if (!pw || !host) return;
    pw.hidden = false;
    if (postUnlocked()) {
      if (lock) lock.hidden = true;
      renderPhase("post", host);
    } else {
      if (lock) lock.hidden = false;
      host.innerHTML = "";
    }
    refreshScoreSpans();
  }
  function renderRatings() {
    var bw = $("ratings-baseline-wrap"), pw = $("ratings-post-wrap");
    if (!bw || !pw) return;
    bw.hidden = false;
    renderPhase("baseline", $("ratings-baseline"));
    renderPostGate();
  }

  function collectSubjectsOnly() {
    var subjects = [];
    SUBJECTS_ALL.forEach(function (s) {
      var cb = $("subj-" + s.replace(/\s+/g, "-"));
      if (cb && cb.checked) subjects.push(s);
    });
    return subjects;
  }

  /* ---- whole form ---- */
  function collectDetails() {
    var ratings = { baseline: {}, post: {} };
    ["baseline", "post"].forEach(function (ph) {
      Object.keys(ratingsState[ph]).forEach(function (k) {
        if (ratingsState[ph][k] !== "" && ratingsState[ph][k] != null) ratings[ph][k] = ratingsState[ph][k];
      });
    });
    return {
      reportDate: $("dt-reportDate").value,
      assessmentDate: $("dt-assessmentDate").value,
      postAssessmentDate: $("dt-postAssessmentDate").value,
      sessions: collectSessions(),
      problems: $("dt-problems").value.trim(),
      effectiveness: $("dt-effectiveness").value.trim(),
      equipmentUsed: $("dt-equipmentUsed").value.trim(),
      softwareUsed: $("dt-softwareUsed").value.trim(),
      additionalNeeds: $("dt-additionalNeeds").value.trim(),
      followUp: $("dt-followUp").value,
      subjects: collectSubjectsOnly(),
      prereqs: {
        baselineCopyReceived: !!($("pq-baseline") && $("pq-baseline").checked)
      },
      ratings: ratings
    };
  }
  function fillDetails(d) {
    $("dt-reportDate").value = d.reportDate || "";
    $("dt-assessmentDate").value = d.assessmentDate || "";
    $("dt-postAssessmentDate").value = d.postAssessmentDate || "";
    $("dt-problems").value = d.problems || "";
    $("dt-effectiveness").value = d.effectiveness || "";
    $("dt-equipmentUsed").value = d.equipmentUsed || "";
    $("dt-softwareUsed").value = d.softwareUsed || "";
    $("dt-additionalNeeds").value = d.additionalNeeds || "";
    $("dt-followUp").value = d.followUp || "";
    SUBJECTS_ALL.forEach(function (s) {
      var cb = $("subj-" + s.replace(/\s+/g, "-"));
      if (cb) cb.checked = d.subjects.indexOf(s) >= 0;
    });
    var subjNote = $("subjects-note");
    if (subjNote) subjNote.textContent = subjectsPrefillNote(currentRecord);
    if ($("pq-baseline")) $("pq-baseline").checked = !!(d.prereqs && d.prereqs.baselineCopyReceived);
    /* The baseline-copy question only exists when the packet has a
       baseline gap — show the confirmation row only then. */
    var pqWrap = $("pq-baseline-wrap");
    if (pqWrap) pqWrap.hidden = !(currentRecord && currentRecord.derived && currentRecord.derived.baselineGap);
    ratingsState = {
      baseline: Object.assign({}, (d.ratings && d.ratings.baseline) || {}),
      post: Object.assign({}, (d.ratings && d.ratings.post) || {})
    };
    if (typeof window !== "undefined" && window.PBRefreshReadiness)
      window.PBRefreshReadiness(d.prereqs || {});
    renderSessions(d.sessions && d.sessions.length ? d.sessions : [blankSession()]);
    renderRatings();
  }
  function setDetailsStatus(msg) { $("details-status").textContent = msg; }

  function buildSubjects() {
    var host = $("subjects-list");
    if (host.childNodes.length) return;
    SUBJECTS_ALL.forEach(function (s) {
      var wrap = document.createElement("div");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = "subj-" + s.replace(/\s+/g, "-");
      cb.addEventListener("change", renderRatings);
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
      setDetailsStatus("Session " + list.length + " added.");
      focusSessionDate(list.length - 1);
    });
    ["pq-baseline"].forEach(function (id) {
      var cb = $(id);
      if (cb) cb.addEventListener("change", function () {
        if (window.PBRefreshReadiness) window.PBRefreshReadiness(collectDetails().prereqs);
      });
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
      var w = validateDetails(details, tasksData() ? tasksData().sections : null, currentRecord);
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
