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

  /* The VR2868 radio options are exactly: "Only in person", "Only remotely",
     "In person and/or remote as dependent on customer's needs". The 1884's
     labels matched on every packet tested, but map explicitly so a variant
     label lands on the right option instead of a "could not set" note. */
  function normalizeDelivery(v) {
    var s = String(v).toLowerCase();
    if (/remote/.test(s) && /person/.test(s)) return "In person and/or remote as dependent on customer's needs";
    if (/remote/.test(s)) return "Only remotely";
    if (/person/.test(s)) return "Only in person";
    return v;
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
    /* "Used in This Training Session" is what the TRAINER used — entered on
       the form. It is NOT copied from the customer's own hardware/software
       on the referral (that is what the customer owns, a different fact). */
    text("Equipment Used in This Training Session", details.equipmentUsed);
    text("Software Used in This Training Session", details.softwareUsed);

    if (record.training.deliveryMethod)
      fields["Services were facilitated"] = { t: "radio", v: normalizeDelivery(record.training.deliveryMethod) };

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

  /* Use-your-own-forms override (Fernando, 2026-11-02 — the hybrid):
     the bundled templates are the default; a trainer who has downloaded
     the current blank forms from TWC can load them in the Generate
     section and they take over for the rest of the page session. Each
     upload is fingerprint-checked before acceptance and its printed
     revision is shown back — from that point the form's currency is the
     provider's responsibility, which is where TWC's rule puts it. */
  var userTemplates = {};      // templateId -> Uint8Array
  var userTemplateRevs = {};   // templateId -> "MM/YY" or null
  var templateCache = {};
  async function loadTemplate(templateId, force) {
    if (userTemplates[templateId]) return userTemplates[templateId];
    if (force) delete templateCache[templateId];
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
    /* Partial packets are for the readout (reporting gaps and conflicts to
       the counselor), not for the report forms: buildPacket would silently
       leave the missing documents' fields blank and produce forms that look
       finished. Refuse, naming what is missing — same stop-don't-guess rule
       as the template fingerprint check below. */
    var missingDocs = (record.derived && record.derived.missingDocuments) || [];
    if (missingDocs.length) {
      setStatus("Not generating: this readout came from a partial packet — missing " + missingDocs.join(", ") + ". The report forms are built from the full packet, so read the complete packet (section 1) and then generate.");
      setNotes(["Missing from the packet that was read: " + missingDocs.join(", ") + "."]);
      return;
    }
    /* A loaded but BLANK VR1884 is the same problem as a missing one: it
       names no customer, counselor, or requested training, so the forms
       would be built on nothing. (Found 2026-11-02 in a roleplay run:
       the readout flagged the blank referral, but this gate only checked
       missingDocuments, which is empty when a blank 1884 is loaded.) */
    if (record.derived && record.derived.referralBlank) {
      setStatus("Not generating: the VR1884 in this packet is blank — it names no customer, counselor, or requested training. Ask the counselor for the completed referral, read the full packet (section 1), and then generate.");
      setNotes(["The blank referral is listed in the readout, with a question for the counselor."]);
      return;
    }
    if (!window.PBDetails) { setStatus("The report form is not loaded."); return; }
    var profile = window.PBDetails.collectProfile();
    var details = window.PBDetails.collect();
    var tasksData = window.PacketBridgeTasks;
    setStatus("Building your packet…");
    setNotes([]);
    try {
      var packet = buildPacket(record, profile, details, tasksData);
      var guardWarnings = (window.PacketBridgeDetails && window.PacketBridgeDetails.validateDetails)
        ? window.PacketBridgeDetails.validateDetails(details, tasksData ? tasksData.sections : null, record) : [];
      var notes = packet.warnings.slice().concat(guardWarnings);
      ["vr2868", "vr2902"].forEach(function (tid) {
        if (userTemplates[tid])
          notes.push("The " + tid.toUpperCase() + " was generated on the form you provided (printed revision " +
            (userTemplateRevs[tid] || "unreadable") + "), not the bundled template.");
      });
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

  /* Manual template recheck (Fernando, 2026-11-02): for a user who left
     the program open, re-load both bundled templates fresh and re-run
     their fingerprint checks on demand, reporting the verified revision
     of each. PacketBridge carries its templates inside itself and never
     sends data anywhere, so it CANNOT pull a newly published TWC form —
     if TWC revises a form, the fix is a new PacketBridge version. This
     button proves the templates in this copy are intact and are the
     revisions listed; the Generate section links the TWC catalog for a
     human comparison. */
  async function recheckTemplates(statusEl) {
    var fr = (window.PacketBridgeExtract && window.PacketBridgeExtract.FORM_REVISIONS) || {};
    var lines = [];
    var ids = ["vr2868", "vr2902"];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], label = id.toUpperCase(), rev = id === "vr2868" ? fr.vr2868 : fr.vr2902;
      if (userTemplates[id]) {
        try {
          var ub = userTemplates[id];
          var updf = await window.PDFLib.PDFDocument.load(ub);
          var unames = updf.getForm().getFields().map(function (f) { return f.getName(); });
          var uprob = checkTemplate(id, unames);
          lines.push(uprob
            ? label + " (the form you loaded, rev " + (userTemplateRevs[id] || "unreadable") + "): PROBLEM — " + uprob
            : label + " (the form you loaded, rev " + (userTemplateRevs[id] || "unreadable") + "): fingerprint OK (" + unames.length + " fields) — this override, not the bundled template, will be used.");
        } catch (ue) { lines.push(label + " (the form you loaded): could not be rechecked — " + (ue && ue.message ? ue.message : ue)); }
        continue;
      }
      try {
        var bytes = await loadTemplate(id, true);
        var pdf = await window.PDFLib.PDFDocument.load(bytes);
        var names = pdf.getForm().getFields().map(function (f) { return f.getName(); });
        var problem = checkTemplate(id, names);
        lines.push(problem
          ? label + " rev " + rev + ": PROBLEM — " + problem + " Do not generate from this copy; download a fresh copy of PacketBridge."
          : label + " rev " + rev + ": fingerprint OK (" + names.length + " fields, matches the verified template).");
      } catch (e) {
        lines.push(label + ": could not be rechecked — " + (e && e.message ? e.message : e));
      }
    }
    lines.push("These templates matched the TWC VR Forms Catalog on " + (fr.verified || "the date this version was built") +
      ". If TWC has published a newer revision since then, this copy cannot fetch it — a new PacketBridge version is needed.");
    statusEl.textContent = lines.join(" ");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var rbtn = document.getElementById("recheck-btn");
    if (rbtn) rbtn.addEventListener("click", function () {
      var st = document.getElementById("recheck-status");
      if (st) { st.textContent = "Rechecking the templates…"; recheckTemplates(st); }
    });
    ["2868", "2902"].forEach(function (num) {
      var input = document.getElementById("tpl-" + num + "-file");
      if (!input) return;
      input.addEventListener("change", async function () {
        var st = document.getElementById("tpl-status");
        var id = "vr" + num, label = "VR" + num;
        var file = input.files && input.files[0];
        if (!file) return;
        try {
          var bytes = new Uint8Array(await file.arrayBuffer());
          var pdf = await window.PDFLib.PDFDocument.load(bytes);
          var names = pdf.getForm().getFields().map(function (f) { return f.getName(); });
          var problem = checkTemplate(id, names);
          if (problem) {
            if (st) st.textContent = label + " not accepted — " + problem + " The bundled template stays in place.";
            input.value = "";
            return;
          }
          var rev = null;
          try {
            if (window.PacketBridgeExtract && window.pdfjsLib) {
              var pdoc = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
              var txt = "";
              for (var pg = 1; pg <= pdoc.numPages; pg++) {
                var tc = await (await pdoc.getPage(pg)).getTextContent();
                tc.items.forEach(function (it) { txt += it.str + " "; });
              }
              rev = window.PacketBridgeExtract.templateRevision(txt, label);
            }
          } catch (e) { rev = null; }
          userTemplates[id] = bytes;
          userTemplateRevs[id] = rev;
          var fr3 = (window.PacketBridgeExtract && window.PacketBridgeExtract.FORM_REVISIONS) || {};
          var knownYY = (id === "vr2868" ? fr3.vr2868 : fr3.vr2902) || "";
          var known = knownYY.replace(/(\d{2}\/)\d{2}(\d{2})/, "$1$2");
          if (st) st.textContent = label + " loaded (" + file.name + "): printed revision " +
            (rev || "could not be read") + ". Structure checks out (" + names.length + " fields). " +
            (rev && known && rev === known
              ? "That is the revision PacketBridge was built and tested against."
              : "PacketBridge was built and tested against rev " + (known || "?") + " (the TWC catalog revision as of " + (fr3.verified || "build") + ") — this form's structure matches, so it will be used, and its currency is your responsibility as the provider.") +
            " It will be used for generation until you reload this page.";
        } catch (e2) {
          if (st) st.textContent = label + " could not be loaded — " + (e2 && e2.message ? e2.message : e2) + " The bundled template stays in place.";
          input.value = "";
        }
      });
    });
    var btn = document.getElementById("generate-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      /* Guard against double-clicks: three downloads in a row are easy to
         duplicate, and some browsers block repeated programmatic downloads.
         The button stays disabled until generation finishes either way. */
      if (btn.disabled) return;
      btn.disabled = true;
      Promise.resolve(generate()).finally(function () { btn.disabled = false; });
    });
  });
})(typeof window !== "undefined" ? window : globalThis);
