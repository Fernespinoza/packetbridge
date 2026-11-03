/* PacketBridge browser glue: pdf.js reading + readout rendering.
   All processing happens in this browser, on this machine. No network use. */
(function () {
  "use strict";
  var pdfjsLib = window.pdfjsLib;
  // Single-file build sets PACKETBRIDGE_WORKER_URL (blob) before this runs.
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.PACKETBRIDGE_WORKER_URL || "lib/pdf.worker.min.js";

  // Offline support (hosted version only): cache the program, never data.
  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline mode is a bonus, not a requirement */ });
  }

  var statusEl = document.getElementById("status");
  var readoutEl = document.getElementById("readout");

  function setStatus(msg) { statusEl.textContent = msg; }

  /* Field reading uses pdf-lib (pdf.js getFieldObjects loses radio groups).
     Quirk found live 2026-10-28: the 1884's delivery-method radio stores its
     /V as a PDF string instead of a name, so getSelected() comes back empty.
     Fallback: read the widgets' appearance states — the selected widget's
     /AS is the chosen option (PDF-name encoded, e.g. /In#20person#2F...). */
  function decodePdfName(s) {
    return String(s).replace(/^\/+/, "").replace(/#([0-9A-Fa-f]{2})/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }

  async function readPdfFields(file) {
    var buf = await file.arrayBuffer();
    var doc = await window.PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
    var form = doc.getForm();
    var flat = {};
    form.getFields().forEach(function (field) { flat[field.getName()] = null; });
    Object.keys(flat).forEach(function (name) {
      try { flat[name] = form.getTextField(name).getText() || null; return; } catch (e) { /* not a text field */ }
      try { flat[name] = form.getCheckBox(name).isChecked() ? "/Yes" : "/Off"; return; } catch (e) { /* not a checkbox */ }
      try {
        var rg = form.getRadioGroup(name);
        var sel = rg.getSelected();
        if (sel) { flat[name] = sel; return; }
        var widgets = rg.acroField.getWidgets();
        for (var i = 0; i < widgets.length; i++) {
          var as = widgets[i].getAppearanceState();
          if (as && String(as) !== "/Off") { flat[name] = decodePdfName(String(as)); return; }
        }
        flat[name] = null; return;
      } catch (e) { /* not a radio group */ }
      try { var dd = form.getDropdown(name).getSelected(); flat[name] = dd && dd.length ? dd[0] : null; return; } catch (e) { /* not a dropdown */ }
      flat[name] = null;
    });
    return flat;
  }

  async function readPdfText(file) {
    var buf = await file.arrayBuffer();
    var doc = await pdfjsLib.getDocument({ data: buf }).promise;
    var pages = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      var line = "";
      tc.items.forEach(function (item) {
        line += item.str;
        line += item.hasEOL ? "\n" : " ";
      });
      pages.push(line);
    }
    return pages.join("\n");
  }

  /* Positioned items for the flattened-1884 parser: pdf.js items carry
     their print coordinates, which the flat layout is keyed to. */
  async function readPdfItems(file) {
    var buf = await file.arrayBuffer();
    var doc = await pdfjsLib.getDocument({ data: buf }).promise;
    var pages = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      pages.push({ items: tc.items.map(function (item) {
        return { str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || 0 };
      }) });
    }
    return pages;
  }

  function el(tag, text) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function addList(parent, items) {
    var ul = el("ul");
    items.forEach(function (item) {
      if (item === null || item === undefined || item === "") return;
      var li = el("li");
      if (typeof item === "string") li.textContent = item;
      else li.appendChild(item);
      ul.appendChild(li);
    });
    parent.appendChild(ul);
    return ul;
  }
  /* Every readout section is collapsible (Fernando, 2026-11-02): a
     native <details> with the heading inside its <summary>, so the
     heading stays navigable and the toggle is keyboard-operable with no
     scripting. Sections start open — collapsing is the reader's choice. */
  function section(title, items) {
    var det = document.createElement("details");
    det.open = true;
    var sum = el("summary");
    sum.appendChild(el("h2", title));
    det.appendChild(sum);
    var body = document.createElement("div");
    addList(body, items);
    det.appendChild(body);
    return det;
  }
  function val(v) { return (v === null || v === undefined || v === "") ? "— not found —" : v; }

  /* Readout pieces with provenance + highlighting (Fernando's rules: every
     fact is labeled with the document it came from; missing info is
     highlighted yellow; conflicts are highlighted red via .conflict). */
  function txt(s) { return document.createTextNode(String(s)); }
  function missSpan() { var s = el("span", "⚠ — not found —"); s.className = "missing"; return s; }
  function piece(v, src) {
    if (v === null || v === undefined || v === "") return missSpan();
    return txt(src ? v + " (from the " + src + ")" : v);
  }
  function line() {
    var f = document.createDocumentFragment();
    Array.prototype.forEach.call(arguments, function (part) {
      if (part === null || part === undefined) return;
      f.appendChild(typeof part === "string" ? txt(part) : part);
    });
    return f;
  }

  /* "Ready to schedule?" block — rendered at the top of the readout and
     re-rendered live when the trainer ticks a prerequisite checkbox in
     the details form (window.PBRefreshReadiness). */
  var lastRecord = null, lastPrereqs = {};
  function fillReadiness(host, rec, prereqs) {
    host.textContent = "";
    if (!window.PacketBridgeExtract.readiness) return;
    var r = window.PacketBridgeExtract.readiness(rec, prereqs);
    var sum = el("summary");
    sum.appendChild(el("h2", "Ready to schedule?"));
    host.appendChild(sum);
    var body = document.createElement("div");
    host.appendChild(body);
    var marks = { pass: "✓ Pass", check: "⚠ Check", missing: "✗ Missing" };
    var ul = el("ul");
    r.items.forEach(function (it) {
      var li = el("li", marks[it.status] + " — " + it.label + ": " + it.detail);
      if (it.status !== "pass") li.className = "missing-line";
      ul.appendChild(li);
    });
    (r.evidence || []).forEach(function (ev) {
      ul.appendChild(el("li", "Evidence — " + ev));
    });
    body.appendChild(ul);
    body.appendChild(el("p", r.summary));
  }
  window.PBRefreshReadiness = function (prereqs) {
    lastPrereqs = prereqs || {};
    var host = document.getElementById("readiness-block");
    if (host && lastRecord) fillReadiness(host, lastRecord, lastPrereqs);
  };

  function renderReadout(rec) {
    readoutEl.textContent = "";
    var frag = document.createDocumentFragment();
    var c = rec.customer, co = rec.counselor, au = rec.authorization || {}, tr = rec.training;

    /* A partial packet may have no 1884, so the customer's name can come
       from the SA or the EAS instead (buildRecord harvests it and records
       the source). */
    var sc = (rec.sources && rec.sources.customer) || {};
    var packetName = c.name || (rec.authorization && rec.authorization.customerName) ||
      (rec.eas && rec.eas.reportFor) || null;
    frag.appendChild(el("h2", "Packet for " + val(packetName) +
      (packetName && sc.name ? " (from the " + sc.name + ")" : "")));
    var fr2 = window.PacketBridgeExtract.FORM_REVISIONS;
    frag.appendChild(el("p", "Form revisions: PacketBridge reads the VR1884 rev " + fr2.vr1884 +
      " and generates the VR2868 rev " + fr2.vr2868 + " and VR2902 rev " + fr2.vr2902 +
      " — the current TWC VR Forms Catalog revisions as of " + fr2.verified + "."));
    if (rec.derived && rec.derived.referralRevision && window.PacketBridgeExtract.FORM_REVISIONS &&
        rec.derived.referralRevision !== window.PacketBridgeExtract.FORM_REVISIONS.vr1884) {
      var rvNote = el("p", "⚠ This referral is on VR1884 rev " + rec.derived.referralRevision +
        ", but PacketBridge reads the " + window.PacketBridgeExtract.FORM_REVISIONS.vr1884 +
        " layout — the form was revised, so fields may have moved. Double-check the readout against the referral itself before relying on it.");
      rvNote.className = "conflict";
      frag.appendChild(rvNote);
    }
    if (rec.derived && rec.derived.referralFlattened)
      frag.appendChild(el("p", "Note: the VR1884 in this packet is a flattened print, so its values were read from the printed text rather than from form fields — double-check them."));
    if (staged["1884"] && staged["1884"].text)
      rec.derived.referralRevision = window.PacketBridgeExtract.referralRevision(staged["1884"].text);
    lastRecord = rec; lastPrereqs = {};
    var readinessHost = document.createElement("details");
    readinessHost.open = true;
    readinessHost.id = "readiness-block";
    fillReadiness(readinessHost, rec, lastPrereqs);
    frag.appendChild(readinessHost);

    /* SA delivery instructions sometimes name who must deliver the
       training. If that name matches neither the trainer nor the provider
       in the saved profile, flag it — the profile lives on this device,
       so the comparison happens here, not in the pure record code. */
    var trainerFlag = null, trainerQuestion = null;
    var namedBySA = au.instructionsTrainer || null;
    if (namedBySA && window.PBDetails && window.PBDetails.collectProfile) {
      var profT = window.PBDetails.collectProfile();
      var who = ((profT.trainer || "") + " " + (profT.providerName || "")).toLowerCase();
      var stopW = { the: 1, and: 1, for: 1, with: 1, inc: 1, llc: 1 };
      var namedWords = namedBySA.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && !stopW[w]; });
      if (namedWords.length && who.trim() && !namedWords.some(function (w) { return who.indexOf(w) !== -1; })) {
        trainerFlag = "⚠ SA delivery instructions name \"" + namedBySA + "\", which does not match the trainer/provider in your saved profile — confirm who should deliver this training.";
        trainerQuestion = "The SA's delivery instructions name \"" + namedBySA + "\" — please confirm who should deliver this training.";
      }
    }

    var missingDocs = (rec.derived && rec.derived.missingDocuments) || [];
    var missingList = missingDocs.map(function (d) { return "⚠ Missing: " + d; });
    if (rec.derived && rec.derived.referralBlank)
      missingList.push("⚠ VR1884 Referral: the copy loaded appears to be unfilled — no customer, counselor, training topics, or delivery method on it.");
    if (rec.derived && rec.derived.baselineGap)
      missingList.push("⚠ Baseline VR2902: this SA funds a post-training assessment but no baseline. Ask the counselor: was a baseline VR2902 already completed (possibly under an earlier SA)? If so, request a copy — the post-training assessment should re-test the same subjects and tasks. If not, ask whether a baseline should be authorized before training begins.");
    (rec.derived && rec.derived.dateFlags || []).forEach(function (f) { missingList.push(f.text); });
    (rec.derived && rec.derived.saMathProblems || []).forEach(function (prob) { missingList.push("⚠ SA math check: " + prob); });
    if (trainerFlag) missingList.push(trainerFlag);
    if (missingList.length) {
      var mSec = section("Missing from this packet", missingList);
      mSec.querySelectorAll("li").forEach(function (li) { li.className = "missing-line"; });
      frag.appendChild(mSec);
    }
    /* Questions routed to the person who can actually answer them:
       the counselor owns the case, the SA issuer owns the authorization,
       and contact facts are asked of the customer directly (Fernando's
       routing, 2026-11-02). */
    var qGroups = window.PacketBridgeExtract.counselorQuestions
      ? window.PacketBridgeExtract.counselorQuestions(rec) : { counselor: [], issuer: [], customer: [] };
    var issuerQs = (qGroups.issuer || []).slice();
    if (trainerQuestion) issuerQs.push(trainerQuestion);
    if (qGroups.counselor.length) frag.appendChild(section("Questions for the counselor", qGroups.counselor));
    if (issuerQs.length) frag.appendChild(section("Questions for the SA issuer", issuerQs));
    if (qGroups.customer.length) frag.appendChild(section("Questions for the customer", qGroups.customer));

    var addrText = [c.address.street, c.address.city, ((c.address.state || "") + " " + (c.address.zip || "")).trim()].filter(Boolean).join(", ");
    var have = [
      line("Date of birth: ", piece(c.dob, sc.dob)),
      line("Address: ", addrText ? piece(addrText, sc.address) : missSpan()),
      line("Phone: ", piece(c.phone, sc.phone), c.altPhone ? txt("  Alternate: " + c.altPhone) : null),
      line("Primary language: ", piece(c.language, sc.language)),
      line("Education: ", piece(c.education, sc.education)),
      line("Vocational goal: ", piece(c.goal, sc.goal)),
      line("Visual diagnosis: ", piece(c.diagnosis, sc.diagnosis)),
      line("Acuity: OD (right) ", piece(c.acuityOD, sc.acuityOD), ", OS (left) ", piece(c.acuityOS, sc.acuityOS), ", visual fields ", piece(c.visualFields, sc.visualFields)),
      line("Secondary disability: ", piece(c.secondaryDisability, sc.secondaryDisability)),
      c.primaryCommunication && c.primaryCommunication !== "N/A" ? line("Primary communication (deaf-blindness): ", txt(c.primaryCommunication)) : null,
      line("Health issues / safety concerns: ", piece(c.healthIssues, sc.healthIssues)),
      line("Current hardware: ", piece(c.currentHardware, sc.currentHardware)),
      line("Current software: ", piece(c.currentSoftware, sc.currentSoftware)),
      c.notes ? line("Notes: ", txt(c.notes)) : null,
      c.circumstances && c.circumstances !== "N/A" ? line("Circumstances that may impact services: ", txt(c.circumstances)) : null,
      line("Best days to contact: ", piece(c.bestDaysToContact, sc.bestDaysToContact))
    ];
    frag.appendChild(section("What we have — customer", have));

    var office = rec.officeFromSA || {};
    var officeText = [office.name, office.street, office.cityLine].filter(Boolean).join(", ");
    var sco = (rec.sources && rec.sources.counselor) || {};
    var caseIds = (rec.derived && rec.derived.caseIdSources) || [];
    var caseIdVal = au.caseId || (rec.eas && rec.eas.caseId) || null;
    var counselorItems = [
      line("Counselor: ", piece(co.name, sco.name), ", caseload ", piece(co.caseload, sco.caseload), ", phone ", piece(co.phone, sco.phone)),
      line("Service Authorization number: ", piece(au.number, "SA")),
      line("Case ID: ", caseIdVal ? txt(caseIdVal + (caseIds.length > 1 ? " (from the " + caseIds[0] + "; also on the " + caseIds[1] + ")" : caseIds.length ? " (from the " + caseIds[0] + ")" : "")) : missSpan()),
      line("SA dates: issued ", piece(au.dateIssued, "SA"), ", runs ", piece(au.startDate, "SA"), " to ", piece(au.endDate, "SA"), ", total $", piece(au.totalCost, "SA")),
      line("Counselor office (from the SA): ", officeText ? txt(officeText) : missSpan()),
      rec.twcContact ? "TWC contact listed on the SA (this is NOT the counselor): " + val(rec.twcContact.name) + ", " + val(rec.twcContact.phone) : null,
      missingDocs.indexOf("EAS Consultation Report") === -1 ? line("EAS consultation date: ", piece(rec.eas && rec.eas.consultDate, "EAS")) : null,
      au.deliveryInstructions ? line("SA delivery instructions: ", txt(au.deliveryInstructions)) : null,
      au.instructionsTrainer ? line("Trainer named in the SA's delivery instructions: ", txt(au.instructionsTrainer)) : null
    ];
    frag.appendChild(section("What we have — counselor and authorization", counselorItems));

    var trainingItems = [
      line("Service requested: ", piece(rec.referral.serviceRequested, "VR1884"), ", referral date ", piece(rec.referral.date, "VR1884")),
      line("Trainer named on the referral: ", piece(rec.referral.trainerNamed, "VR1884")),
      line("Delivery method: ", piece(tr.deliveryMethod, "VR1884")),
      tr.locations.length ? line("Training location: ", txt(tr.locations.join("; ") + " (from the VR1884)")) : "Training location: none marked on the 1884",
      tr.deliveryComments ? "Delivery comments: " + tr.deliveryComments : null,
      rec.referral.atEvalProvided ? "AT Evaluation Report was provided at referral (from the VR1884)" : null,
      rec.referral.otherInfoDescription ? "Other information provided at referral: " + rec.referral.otherInfoDescription
        : (rec.referral.otherInfoProvided ? "Other additional information was marked as provided at referral, with no description on the 1884" : null)
    ];
    (rec.lineItems || []).forEach(function (i) {
      trainingItems.push("Authorized on SA: " + i.description + " — " + i.qty + " " + i.unit + " at $" + i.unitCost + " = $" + i.totalCost);
    });
    tr.topics.forEach(function (t) {
      trainingItems.push("Topic: " + t.label + (t.description ? " — " + t.description : "") + " (from the VR1884)");
    });
    trainingItems.push("Assessment subjects for the VR2902s: " + (rec.derived.subjects2902.length ? rec.derived.subjects2902.join(", ") : "none derived"));
    rec.derived.subjectNotes.forEach(function (n) { trainingItems.push("Note: " + n); });
    if (rec.derived.suggestedSubjects && rec.derived.suggestedSubjects.length) {
      trainingItems.push("Suggested subjects from the EAS recommendations (suggestions only — the 1884 decides when one is loaded): " +
        rec.derived.suggestedSubjects.map(function (s) { return s.subject + " (" + s.reason + ")"; }).join("; "));
    }
    (rec.derived.suggestionNotes || []).forEach(function (n) { trainingItems.push("Note: " + n); });
    trainingItems.push("Documents this packet needs: " + (rec.derived.documentsToGenerate.length ? rec.derived.documentsToGenerate.join(", ") : "none detected — check the SA"));
    if (tr.unknownTopicStates.length)
      trainingItems.push("Could not read the checkbox state for: " + tr.unknownTopicStates.join(", ") + " — check the paper 1884 for these topics.");
    frag.appendChild(section("Training being requested", trainingItems));

    if (rec.derived.conflicts.length) {
      var cf = section("Conflicts to check — the sources disagree", rec.derived.conflicts.map(function (x) { return x; }));
      cf.querySelectorAll("li").forEach(function (li) { li.className = "conflict"; });
      frag.appendChild(cf);
    } else if (missingDocs.length === 2) {
      frag.appendChild(section("Conflicts to check", ["Only one document was loaded, so there is nothing to compare it against — conflicts are found by comparing the documents in a packet. Load the missing documents above to run the cross-checks."]));
    } else if (missingDocs.length) {
      frag.appendChild(section("Conflicts to check", ["None detected among the documents loaded — the cross-checks only compare documents that are present, so the missing documents above could not be checked."]));
    } else {
      frag.appendChild(section("Conflicts to check", ["None detected — the 1884, SA, and EAS agree on the fields checked."]));
    }

    /* The provider-profile reminder only appears when no complete profile
       is saved on this device — once profile info is detected, the bullet
       is noise (Fernando's call, 2026-11-02). */
    var profileComplete = false;
    if (window.PBDetails && window.PBDetails.collectProfile) {
      var prof = window.PBDetails.collectProfile();
      profileComplete = ["providerName", "street", "city", "state", "zip", "phone", "fax", "email", "trainer"]
        .every(function (k) { return prof[k] && String(prof[k]).trim() !== ""; });
    }
    var stillMissing = [];
    if (!profileComplete)
      stillMissing.push("Your provider profile (entered once, reused every packet): provider name, address, phone, fax, email, and trainer name.");
    stillMissing.push(
      "For this packet: the report date, and the assessment date for the VR2902s.",
      "From the training itself: session dates, hours, and descriptions for the VR2868; the equipment and software used in the training; what was covered, any software or hardware problems, and training effectiveness.",
      "Assessment ratings for the VR2902s — or leave them blank in Prep mode and fill them after the assessment.",
      "Stays blank by design: signatures and dates signed, the director block, and all VR staff verification fields."
    );
    frag.appendChild(section("What is still missing — you supply this", stillMissing));

    readoutEl.appendChild(frag);
  }

  /* ---- any-order loader: files identify themselves ----
     The user picks or drops the packet files in any order; each file is
     classified on arrival (1884 by its form fields, SA/EAS by content —
     see extract.js) and staged under its kind. Read builds the record from
     whatever was staged. Swapping files between slots is impossible now
     because there are no slots (Fernando's accident, 2026-11-02). */
  var KIND_LABEL = { "1884": "VR1884 Referral", "SA": "Service Authorization (SA)", "EAS": "EAS Consultation Report" };
  var staged = {};        /* kind -> { name, fields, text } */
  var stagedNotes = [];   /* unidentifiable files and duplicates, by name */
  var flat1884Name = null;

  function renderStaged() {
    var host = document.getElementById("staged-list");
    host.innerHTML = "";
    ["1884", "SA", "EAS"].forEach(function (kind) {
      if (!staged[kind]) return;
      var li = document.createElement("li");
      li.textContent = "✓ " + staged[kind].name + " — identified as the " + KIND_LABEL[kind] +
        (staged[kind].flat ? " (flattened print — values read from the printed text)" : "");
      host.appendChild(li);
    });
    if (flat1884Name) {
      var lf = document.createElement("li");
      lf.textContent = "⚠ " + flat1884Name + " — looks like a VR1884 but has no fillable form fields (flattened or scanned); it cannot be read";
      host.appendChild(lf);
    }
    stagedNotes.forEach(function (n) {
      var li = document.createElement("li");
      li.textContent = "✗ " + n.text;
      host.appendChild(li);
    });
  }

  async function stageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    setStatus("Identifying " + files.length + " file" + (files.length === 1 ? "" : "s") + "…");
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var fields = null, text = null, kind = null;
      try { fields = await readPdfFields(file); } catch (e) { fields = null; }
      if (window.PacketBridgeExtract.is1884Fields(fields)) {
        kind = "1884";
        /* Also load the text (best effort): the form's printed title
           carries its revision ("VR1884 (08/25)"), which the readout
           checks against the layout this build reads. */
        try { text = await readPdfText(file); } catch (e) { text = null; }
      } else {
        try { text = await readPdfText(file); } catch (e) { text = null; }
        kind = text ? window.PacketBridgeExtract.classifyText(text) : null;
        if (!kind && text && (!fields || Object.keys(fields).length === 0) && window.PacketBridgeExtract.isFlat1884Text(text)) {
          /* A flattened VR1884 (TWC system print): no form fields, but its
             values are in the positioned print text — parse them. */
          var flatParsed = null;
          try { flatParsed = window.PacketBridgeExtract.parseFlat1884(await readPdfItems(file)); } catch (e) { flatParsed = null; }
          if (flatParsed && !staged["1884"]) { staged["1884"] = { name: file.name, fields: null, text: text, flat: flatParsed }; continue; }
          if (flatParsed) { stagedNotes.push({ name: file.name, text: file.name + " — also a VR1884 Referral; keeping " + staged["1884"].name }); continue; }
          if (!flat1884Name && !staged["1884"]) flat1884Name = file.name;
          else stagedNotes.push({ name: file.name, text: file.name + " — another flattened VR1884; only one can be used" });
          continue;
        }
      }
      if (!kind) { stagedNotes.push({ name: file.name, text: file.name + " — does not match any of the three expected forms (VR1884 Referral, Service Authorization, EAS Consultation Report); it will not be loaded" }); continue; }
      if (staged[kind]) { stagedNotes.push({ name: file.name, text: file.name + " — also looks like the " + KIND_LABEL[kind] + "; keeping " + staged[kind].name }); continue; }
      staged[kind] = { name: file.name, fields: fields, text: text };
    }
    renderStaged();
    var got = Object.keys(staged).map(function (k) { return KIND_LABEL[k]; });
    setStatus(got.length
      ? "Identified: " + got.join(", ") + ". Press Read packet when you're ready."
      : "None of those files could be identified as a VR1884, an SA, or an EAS.");
  }

  var picker = document.getElementById("packet-files");
  picker.addEventListener("change", function () { stageFiles(picker.files); });
  document.getElementById("clear-files").addEventListener("click", function () {
    staged = {}; stagedNotes = []; flat1884Name = null;
    picker.value = "";
    renderStaged();
    setStatus("Files cleared. Pick or drop the packet files when you're ready.");
  });
  var zone = document.getElementById("drop-zone");
  ["dragenter", "dragover"].forEach(function (evName) {
    zone.addEventListener(evName, function (ev) { ev.preventDefault(); zone.classList.add("dragging"); });
  });
  ["dragleave", "drop"].forEach(function (evName) {
    zone.addEventListener(evName, function (ev) { ev.preventDefault(); zone.classList.remove("dragging"); });
  });
  zone.addEventListener("drop", function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files) stageFiles(ev.dataTransfer.files);
  });

  document.getElementById("packet-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    /* Any subset of the packet may be read — the readout lists what is
       missing. Only a completely empty submission is refused. */
    if (!Object.keys(staged).length) {
      setStatus(flat1884Name
        ? "That 1884 has no fillable form fields — it may be a flattened or scanned copy. PacketBridge needs the fillable PDF."
        : stagedNotes.length
          ? "None of the files you picked match the three expected forms (VR1884 Referral, Service Authorization, or EAS Consultation Report), so there is nothing to read yet."
          : "No files picked yet — choose or drop at least one packet file (the VR1884, the SA, or the EAS), then read the packet.");
      return;
    }
    setStatus("Reading packet…");
    try {
      var fields = staged["1884"] ? staged["1884"].fields : null;
      var saText = staged["SA"] ? staged["SA"].text : null;
      var easText = staged["EAS"] ? staged["EAS"].text : null;
      var record = window.PacketBridgeExtract.buildRecord(fields, saText, easText,
        staged["1884"] && staged["1884"].flat ? staged["1884"].flat : null);
      renderReadout(record);
      if (window.PBDetails && window.PBDetails.onRecord) window.PBDetails.onRecord(record);
      var missingDocs = (record.derived && record.derived.missingDocuments) || [];
      setStatus("Done. Readout is below" + (missingDocs.length ? " — note: this packet was read without " + missingDocs.join(", ") + "; the readout lists what is missing." : ".") +
        (flat1884Name ? " (The VR1884 file " + flat1884Name + " could not be read — it has no fillable form fields.)" : "") +
        (stagedNotes.length ? " Not loaded: " + stagedNotes.map(function (n) { return n.name; }).join(", ") + " — see the file list above for why." : ""));
      document.getElementById("readout-h").setAttribute("tabindex", "-1");
      document.getElementById("readout-h").focus({ preventScroll: false });
    } catch (err) {
      setStatus("Something went wrong reading that packet: " + err.message);
    }
  });
})();
