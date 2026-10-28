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

  function el(tag, text) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function addList(parent, items) {
    var ul = el("ul");
    items.forEach(function (item) {
      if (item === null || item === undefined || item === "") return;
      ul.appendChild(el("li", item));
    });
    parent.appendChild(ul);
    return ul;
  }
  function section(title, items) {
    var frag = document.createDocumentFragment();
    frag.appendChild(el("h2", title));
    addList(frag, items);
    return frag;
  }
  function val(v) { return (v === null || v === undefined || v === "") ? "— not found —" : v; }

  function renderReadout(rec) {
    readoutEl.textContent = "";
    var frag = document.createDocumentFragment();
    var c = rec.customer, co = rec.counselor, au = rec.authorization || {}, tr = rec.training;

    frag.appendChild(el("h2", "Packet for " + val(c.name)));

    var have = [
      "Date of birth: " + val(c.dob),
      "Address: " + [c.address.street, c.address.city, ((c.address.state || "") + " " + (c.address.zip || "")).trim()].filter(Boolean).join(", "),
      "Phone: " + val(c.phone) + (c.altPhone ? "  Alternate: " + c.altPhone : ""),
      "Primary language: " + val(c.language),
      "Education: " + val(c.education),
      "Vocational goal: " + val(c.goal),
      "Visual diagnosis: " + val(c.diagnosis),
      "Acuity: OD (right) " + val(c.acuityOD) + ", OS (left) " + val(c.acuityOS) + ", visual fields " + val(c.visualFields),
      "Secondary disability: " + val(c.secondaryDisability),
      "Health issues / safety concerns: " + val(c.healthIssues),
      "Current hardware: " + val(c.currentHardware),
      "Current software: " + val(c.currentSoftware),
      c.notes ? "Notes: " + c.notes : null,
      "Best days to contact: " + val(c.bestDaysToContact)
    ];
    frag.appendChild(section("What we have — customer", have));

    var office = rec.officeFromSA || {};
    var counselorItems = [
      "Counselor: " + val(co.name) + ", caseload " + val(co.caseload) + ", phone " + val(co.phone) + " (phone from the 1884)",
      "Service Authorization number: " + val(au.number),
      "Case ID: " + val(au.caseId),
      "SA dates: issued " + val(au.dateIssued) + ", runs " + val(au.startDate) + " to " + val(au.endDate) + ", total $" + val(au.totalCost),
      "Counselor office (from SA): " + [office.name, office.street, office.cityLine].filter(Boolean).join(", "),
      rec.twcContact ? "TWC contact listed on the SA (this is NOT the counselor): " + val(rec.twcContact.name) + ", " + val(rec.twcContact.phone) : null
    ];
    frag.appendChild(section("What we have — counselor and authorization", counselorItems));

    var trainingItems = [
      "Service requested: " + val(rec.referral.serviceRequested) + ", referral date " + val(rec.referral.date),
      "Delivery method: " + val(tr.deliveryMethod),
      "Training location: " + (tr.locations.length ? tr.locations.join("; ") : "none marked on the 1884"),
      tr.deliveryComments ? "Delivery comments: " + tr.deliveryComments : null
    ];
    (rec.lineItems || []).forEach(function (i) {
      trainingItems.push("Authorized on SA: " + i.description + " — " + i.qty + " " + i.unit + " at $" + i.unitCost + " = $" + i.totalCost);
    });
    tr.topics.forEach(function (t) {
      trainingItems.push("Topic: " + t.label + (t.description ? " — " + t.description : ""));
    });
    trainingItems.push("Assessment subjects for the VR2902s: " + (rec.derived.subjects2902.length ? rec.derived.subjects2902.join(", ") : "none derived"));
    rec.derived.subjectNotes.forEach(function (n) { trainingItems.push("Note: " + n); });
    trainingItems.push("Documents this packet needs: " + (rec.derived.documentsToGenerate.length ? rec.derived.documentsToGenerate.join(", ") : "none detected — check the SA"));
    if (tr.unknownTopicStates.length)
      trainingItems.push("Could not read the checkbox state for: " + tr.unknownTopicStates.join(", ") + " — check the paper 1884 for these topics.");
    frag.appendChild(section("Training being requested", trainingItems));

    if (rec.derived.conflicts.length) {
      var cf = section("Conflicts to check — the sources disagree", rec.derived.conflicts.map(function (x) { return x; }));
      cf.querySelectorAll("li").forEach(function (li) { li.className = "conflict"; });
      frag.appendChild(cf);
    } else {
      frag.appendChild(section("Conflicts to check", ["None detected — the 1884, SA, and EAS agree on the fields checked."]));
    }

    frag.appendChild(section("What is still missing — you supply this", [
      "Your provider profile (entered once, reused every packet): provider name, address, phone, fax, email, and trainer name.",
      "For this packet: the report date, and the assessment date for the VR2902s.",
      "From the training itself: session dates, hours, and descriptions for the VR2868; what was covered, any software or hardware problems, and training effectiveness.",
      "Assessment ratings for the VR2902s — or leave them blank in Prep mode and fill them after the assessment.",
      "Stays blank by design: signatures and dates signed, the director block, and all VR staff verification fields."
    ]));

    readoutEl.appendChild(frag);
  }

  document.getElementById("packet-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var f1884 = document.getElementById("f1884").files[0];
    var fsa = document.getElementById("fsa").files[0];
    var feas = document.getElementById("feas").files[0];
    if (!f1884) { setStatus("Pick the VR1884 referral PDF first."); return; }
    setStatus("Reading packet…");
    try {
      var fields = await readPdfFields(f1884);
      if (!fields || Object.keys(fields).length === 0) {
        setStatus("That 1884 has no fillable form fields — it may be a flattened or scanned copy. PacketBridge v0.1 needs the fillable PDF.");
        return;
      }
      var saText = fsa ? await readPdfText(fsa) : null;
      var easText = feas ? await readPdfText(feas) : null;
      var record = window.PacketBridgeExtract.buildRecord(fields, saText, easText);
      renderReadout(record);
      setStatus("Done. Readout is below" + (fsa ? "" : " — note: no SA was loaded, so authorization details are missing.") + (feas ? "" : " No EAS was loaded."));
      document.getElementById("readout-h").setAttribute("tabindex", "-1");
      document.getElementById("readout-h").focus({ preventScroll: false });
    } catch (err) {
      setStatus("Something went wrong reading that packet: " + err.message);
    }
  });
})();
