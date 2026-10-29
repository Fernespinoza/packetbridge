/* PacketBridge — Phase 4 generation.
   Pure core: buildPacket(record, profile, details, tasksData) -> three fill
   maps (VR2902 baseline, VR2868, VR2902 post — in Fernando's packet order)
   plus warnings. DOM layer: verifies the template revision by field
   fingerprint, fills the real TWC PDFs with pdf-lib, downloads them.

   Conventions mirror Fernando's own course shells: long dates
   ("October 27, 2026"), hours as "1 hour"/"2 hours", unused service rows
   "N/A", unassessed VR2902 subjects "N/A" in every task + score field,
   assessed subjects in Prep mode left blank. */
(function (global) {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  function longDate(iso) {
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso; /* already free-form — pass through */
    return MONTHS[parseInt(m[2], 10) - 1] + " " + parseInt(m[3], 10) + ", " + m[1];
  }

  function splitPhone(str) {
    if (!str) return { area: "", rest: "" };
    var d = String(str).replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length < 10) return { area: "", rest: String(str) };
    return { area: d.slice(0, 3), rest: d.slice(3, 6) + "-" + d.slice(6, 10) };
  }

  function hoursText(h) {
    var n = parseFloat(h);
    if (isNaN(n)) return String(h || "");
    return n + (n === 1 ? " hour" : " hours");
  }

  /* UI subject -> the VR2902's own checkbox field name. Subjects with no
     entry here (Email, Outlook, PowerPoint) do not exist on the form. */
  var SUBJECT_CHECKBOX = {
    "Microsoft Windows": "Assessment will measure subject Microsoft Windows",
    "Microsoft Word": "Assessment will measure subject Microsoft Word",
    "Internet": "Assessment will measure subject Internet",
    "Screen Magnification": "Assessment will measure subject Screen Magnification",
    "Screen Reader": "Assessment will measure subject Screen Reader",
    "Microsoft Excel": "Assessment will measure subject Spreadsheet",
    "Keyboard Knowledge": "Assessment will measure subject Keyboard Knowledge",
    "Notetaker": "Assessment will measure subject Notetaker",
    "Optical Character Recognition": "Assessment will measure subject Optical Character Recognition OCR"
  };
  var KB_SPEED_CHECKBOX = "Assessment will measure subject Keyboard Speed Typing Speed";

  function scoreForGroup(ratingsObj, group) {
    var sum = 0, rated = 0;
    group.tasks.forEach(function (t) {
      var v = ratingsObj ? ratingsObj[t.field] : undefined;
      if (v === "0" || v === "1" || v === "2") { sum += parseInt(v, 10); rated++; }
    });
    return { sum: rated ? sum : null, rated: rated, total: group.tasks.length };
  }

  function build2902(record, profile, details, tasksData, phase) {
    var warnings = [];
    var fields = {}; /* name -> {t:'text',v} | {t:'check'} | {t:'radio',v} */
    function text(name, v) { if (v !== undefined && v !== null && v !== "") fields[name] = { t: "text", v: String(v) }; }
    function check(name) { fields[name] = { t: "check" }; }

    text("Customer name", record.customer.name);
    text("Evaluator name", profile.trainer);
    text("Report completed by print name", profile.trainer);
    var dateIso = phase === "baseline" ? details.assessmentDate : details.postAssessmentDate;
    if (dateIso) text("Date", longDate(dateIso));
    else warnings.push("No " + (phase === "baseline" ? "baseline" : "post-training") + " assessment date entered — the VR2902 date is blank.");
    fields["Assessment Type"] = { t: "radio", v: phase === "baseline" ? "Baseline Assessment" : "Post-Training Assessment" };

    var ratings = (details.ratings && details.ratings[phase]) || {};
    var complete = details.mode === "complete";

    details.subjects.forEach(function (s) {
      if (SUBJECT_CHECKBOX[s]) check(SUBJECT_CHECKBOX[s]);
      else warnings.push(s + " is not a subject on the VR2902 form — it has no checkbox or task list there, so it was left off the " + phase + " assessment.");
    });

    tasksData.sections.forEach(function (sec) {
      var selected = details.subjects.indexOf(sec.subject) >= 0;
      sec.groups.forEach(function (g) {
        g.tasks.forEach(function (t) {
          if (!selected) text(t.field, "N/A");
          else if (complete && ratings[t.field]) text(t.field, ratings[t.field]);
        });
        if (!selected) text(g.scoreField, "N/A");
        else if (complete) {
          var sc = scoreForGroup(ratings, g);
          if (sc.sum !== null) text(g.scoreField, String(sc.sum));
          else warnings.push(sec.subject + " (" + g.label + ") is selected but has no " + phase + " ratings — its score is blank.");
        }
      });
    });

    /* Typing speed: entered WPM wins; otherwise the shells' "N/A". */
    var gross = ratings["Keyboard Speed Gross WPM"], net = ratings["Keyboard Speed Net WPM"];
    if (gross || net) {
      check(KB_SPEED_CHECKBOX);
      text("Keyboard Speed Gross WPM", gross || "");
      text("Keyboard Speed Net WPM", net || "");
    } else {
      text("Keyboard Speed Gross WPM", "N/A");
      text("Keyboard Speed Net WPM", "N/A");
    }
    return { fields: fields, warnings: warnings };
  }

  function build2868(record, profile, details) {
    var warnings = [];
    var fields = {};
    function text(name, v) { if (v !== undefined && v !== null && v !== "") fields[name] = { t: "text", v: String(v) }; }

    text("Customer", record.customer.name);
    text("Customer Street Address", record.customer.address.street);
    text("Customer City", record.customer.address.city);
    text("Customer State", record.customer.address.state);
    text("Customer ZIP Code", record.customer.address.zip);
    var cp = splitPhone(record.customer.phone);
    text("Customer Phone Number area code 3 digits", cp.area);
    text("Customer phone number 7 digits", cp.rest);

    text("Counselor", record.counselor.name);
    text("VR Counselor Name", record.counselor.name);
    text("VR Caseload Number", record.counselor.caseload);
    var kp = splitPhone(record.counselor.phone);
    text("Counselor Phone Number area code 3 digits", kp.area);
    text("Counselor phone number 7 digits", kp.rest);
    var office = (record.officeFromSA && record.officeFromSA.name) ? record.officeFromSA : (record.eas ? record.eas.office : null);
    if (office) {
      text("Counselor VR Office", office.name);
      text("Counselor Street Address", office.street);
      text("Counselor City", office.city);
      text("Counselor State", office.state);
      text("Counselor ZIP Code", office.zip);
    }
    text("Customer Service Authorization Number", record.authorization.number);

    text("Provider", profile.providerName);
    text("Provider Street Address", profile.street);
    text("Provider City", profile.city);
    text("Provider State", profile.state);
    text("Provider ZIP Code", profile.zip);
    var pp = splitPhone(profile.phone);
    text("Provider Phone Number area code 3 digits", pp.area);
    text("Provider phone number 7 digits", pp.rest);
    text("Provider Full Fax Number", profile.fax);
    text("Provider Email Address", profile.email);
    text("Provider Trainer", profile.trainer);
    if (details.reportDate) text("Provider Report Date", longDate(details.reportDate));

    var objectives = record.training.topics.map(function (t) {
      return t.description ? (t.label + " — " + t.description) : t.label;
    });
    text("Training Objectives", objectives.join("\n"));
    text("Equipment Used in This Training Session", record.customer.currentHardware);
    text("Software Used in This Training Session", record.customer.currentSoftware);

    if (record.training.deliveryMethod)
      fields["Services were facilitated"] = { t: "radio", v: record.training.deliveryMethod };

    var sessions = details.sessions.filter(function (s) { return s.date || s.hours || s.description; });
    if (!sessions.length) warnings.push("No sessions entered — all 14 service rows are N/A.");
    for (var i = 0; i < 14; i++) {
      var n = i + 1;
      if (i < sessions.length) {
        text("Service " + n + " Date", longDate(sessions[i].date));
        text("Service " + n + " Total Hours", hoursText(sessions[i].hours));
        text("Service " + n + " Description", sessions[i].description);
      } else {
        text("Service " + n + " Date", "N/A");
        text("Service " + n + " Total Hours", "N/A");
        text("Service " + n + " Description", "N/A");
      }
    }

    text("Software or Hardware Problems", details.problems);
    var eff = details.effectiveness || "";
    var extra = [];
    if (details.additionalNeeds) extra.push("Additional training needs: " + details.additionalNeeds);
    if (details.followUp) extra.push("Recommended follow-up period: " + details.followUp);
    if (extra.length) {
      eff = (eff ? eff + "\n\n" : "") + extra.join("\n");
      warnings.push("The current VR2868 has no separate field for additional training needs or follow-up period, so they were appended to Training Effectiveness.");
    }
    text("Training Effectiveness", eff);
    return { fields: fields, warnings: warnings };
  }

  function buildPacket(record, profile, details, tasksData) {
    var base = build2902(record, profile, details, tasksData, "baseline");
    var mid = build2868(record, profile, details);
    var post = build2902(record, profile, details, tasksData, "post");
    var safe = (record.customer.name || "Customer").replace(/[\\/:*?"<>|]/g, "");
    return {
      docs: [
        { id: "vr2902-baseline", title: "VR2902 Baseline Assessment", template: "vr2902",
          filename: "VR2902 Baseline Assessment - " + safe + ".pdf", fields: base.fields },
        { id: "vr2868", title: "VR2868 Training Report", template: "vr2868",
          filename: "VR2868 Training Report - " + safe + ".pdf", fields: mid.fields },
        { id: "vr2902-post", title: "VR2902 Post-Training Assessment", template: "vr2902",
          filename: "VR2902 Post-Training Assessment - " + safe + ".pdf", fields: post.fields }
      ],
      warnings: base.warnings.concat(mid.warnings, post.warnings)
    };
  }

  /* Template fingerprints: if TWC revises a form, field count + sentinels
     stop matching and generation refuses instead of filling the wrong form. */
  var FINGERPRINTS = {
    vr2868: { count: 104, sentinels: ["Services were facilitated", "Service 14 Description", "Customer Service Authorization Number", "Training Objectives"] },
    vr2902: { count: 97, sentinels: ["Assessment Type", "Keyboard Knowledge Skills score", "Microsoft Windows Rating 1 Open the start menu", "Customer name"] }
  };
  function checkTemplate(templateId, fieldNames) {
    var fp = FINGERPRINTS[templateId];
    if (!fp) return "Unknown template " + templateId;
    if (fieldNames.length !== fp.count)
      return "Template mismatch: expected " + fp.count + " fields, found " + fieldNames.length + ". The form may have been revised — generation stopped for this document.";
    for (var i = 0; i < fp.sentinels.length; i++)
      if (fieldNames.indexOf(fp.sentinels[i]) < 0)
        return "Template mismatch: missing field '" + fp.sentinels[i] + "'. The form may have been revised — generation stopped for this document.";
    return null;
  }

  var logic = { longDate: longDate, splitPhone: splitPhone, hoursText: hoursText,
    buildPacket: buildPacket, build2868: build2868, build2902: build2902,
    checkTemplate: checkTemplate, FINGERPRINTS: FINGERPRINTS, SUBJECT_CHECKBOX: SUBJECT_CHECKBOX };
  if (typeof module !== "undefined" && module.exports) module.exports = logic;
  global.PacketBridgeGenerate = logic;

  /* ---------------- DOM layer (browser only) ---------------- */
  if (typeof document === "undefined") return;

  function setStatus(msg) { document.getElementById("generate-status").textContent = msg; }
  function setNotes(items) {
    var ul = document.getElementById("generate-notes");
    ul.innerHTML = "";
    items.forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      ul.appendChild(li);
    });
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  var templateCache = {};
  async function loadTemplate(templateId) {
    if (templateCache[templateId]) return templateCache[templateId];
    var bytes;
    if (window.PB_TEMPLATES && window.PB_TEMPLATES[templateId]) {
      bytes = b64ToBytes(window.PB_TEMPLATES[templateId]);
    } else {
      var path = templateId === "vr2868" ? "templates/VR2868.pdf" : "templates/VR2902.pdf";
      var res = await fetch(path);
      if (!res.ok) throw new Error("Could not load the " + templateId.toUpperCase() + " template file (" + res.status + ").");
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    templateCache[templateId] = bytes;
    return bytes;
  }

  async function fillDoc(doc, templateBytes) {
    var pdf = await window.PDFLib.PDFDocument.load(templateBytes);
    var form = pdf.getForm();
    var names = form.getFields().map(function (f) { return f.getName(); });
    var problem = checkTemplate(doc.template, names);
    if (problem) throw new Error(doc.title + ": " + problem);
    var skipped = [];
    Object.keys(doc.fields).forEach(function (name) {
      var spec = doc.fields[name];
      try {
        if (spec.t === "text") form.getTextField(name).setText(spec.v);
        else if (spec.t === "check") form.getCheckBox(name).check();
        else if (spec.t === "radio") form.getRadioGroup(name).select(spec.v);
      } catch (e) { skipped.push(name); }
    });
    var out = await pdf.save();
    return { bytes: out, skipped: skipped };
  }

  function download(filename, bytes) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  }

  async function generate() {
    var state = window.PBState || {};
    var record = state.record;
    if (!record) { setStatus("Read a referral packet first (section 1), then generate."); return; }
    if (!window.PBDetails) { setStatus("The report form is not loaded."); return; }
    var profile = window.PBDetails.collectProfile();
    var details = window.PBDetails.collect();
    var tasksData = window.PacketBridgeTasks;
    setStatus("Building your packet…");
    setNotes([]);
    try {
      var packet = buildPacket(record, profile, details, tasksData);
      var notes = packet.warnings.slice();
      for (var i = 0; i < packet.docs.length; i++) {
        var doc = packet.docs[i];
        var tpl = await loadTemplate(doc.template);
        var filled = await fillDoc(doc, tpl);
        download(doc.filename, filled.bytes);
        if (filled.skipped.length) notes.push(doc.title + ": could not set " + filled.skipped.join(", ") + " (the template may differ).");
        setStatus("Downloaded " + (i + 1) + " of " + packet.docs.length + ": " + doc.filename);
        await new Promise(function (r) { setTimeout(r, 450); });
      }
      if (!profile.providerName || !profile.trainer)
        notes.push("Your provider profile looks incomplete — the Provider/Trainer lines on the forms use it. Fill it in (section 3) and regenerate if anything is missing.");
      setStatus("Done — all three PDFs downloaded, in packet order: VR2902 Baseline, VR2868, VR2902 Post-Training. Nothing was uploaded; the files are on this computer only.");
      setNotes(notes);
      window.PBState = { record: record, profile: profile, details: details, lastPacket: packet };
    } catch (e) {
      setStatus("Generation stopped: " + e.message);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("generate-btn");
    if (btn) btn.addEventListener("click", generate);
  });
})(typeof window !== "undefined" ? window : globalThis);
