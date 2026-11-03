/* PacketBridge extraction core — rule-based, no AI, no network.
   Pure parsing functions: same logic as prototype/extract.py (Python proof).
   Browser glue (pdf.js) lives in app.js; tests run these functions in Node. */
(function (global) {
  "use strict";

  function clean(v) {
    if (v === null || v === undefined) return null;
    v = String(v).replace(/\s+/g, " ").trim();
    return v === "" ? null : v;
  }
  function rawClean(v) { // keep newlines for text docs
    if (v === null || v === undefined) return null;
    v = String(v).trim();
    return v === "" ? null : v;
  }
  function stripTrailingComma(s) { return s ? s.replace(/,\s*$/, "") : s; }

  var TOPICS = [
    "Key Boarding Skills",
    "Setting up the Workstation",
    "Operating Feature Function and Maintenance",
    "Screen Readers Screen Magnification Braille Access and Speech Recognition Access",
    "The Word Processor",
    "The Internet and the World Wide Web",
    "Viewing and Creating Microsoft PowerPoint Presentations",
    "Viewing and Creating Spreadsheets using Microsoft Excel",
    "OCR Software with scannercameras standalone OCR Devices and Braille Translation Software with Braille embossers",
    "Braille Note Takers",
    "Mobile Operating Systems",
    "Computer Skills and Mobile Operating System Skills Post Training Assessments",
    "Other Training Topics"
  ];
  var TOPIC_LABELS = {
    "Key Boarding Skills": "Keyboarding Skills",
    "Screen Readers Screen Magnification Braille Access and Speech Recognition Access": "Screen Readers / Magnification / Braille Access / Speech Recognition",
    "OCR Software with scannercameras standalone OCR Devices and Braille Translation Software with Braille embossers": "OCR Software / Devices & Braille Translation",
    "Computer Skills and Mobile Operating System Skills Post Training Assessments": "Post-Training Assessments"
  };
  function topicLabel(t) { return TOPIC_LABELS[t] || t; }

  var LOCATIONS = [
    ["AT service providers facility", "AT service provider's facility"],
    ["Customers homefamily home", "Customer's home / family home"],
    ["Customers work site", "Customer's work site"],
    ["Customers school or vocational training site", "Customer's school / vocational training site"],
    ["Unknown", "Unknown"]
  ];

  function isChecked(v) {
    if (v === true) return true;
    if (typeof v === "string") {
      var s = v.trim();
      return s !== "" && s !== "/Off" && s !== "Off" && s !== "false";
    }
    return false;
  }

  function parse1884(fields) {
    function get(name) { return clean(fields[name]); }
    var topics = [], unknownTopics = [];
    TOPICS.forEach(function (t) {
      var key = t === "Other Training Topics" ? "Other Training Topics" : "Training Topic " + t;
      var descKey = t === "Other Training Topics" ? "Description of Other Training Topics" : "Description of Training Topic " + t;
      var present = Object.prototype.hasOwnProperty.call(fields, key);
      var v = present ? fields[key] : null;
      if (present && (v === null || v === undefined)) {
        unknownTopics.push(topicLabel(t));
      } else if (isChecked(v)) {
        topics.push({ topic: t, label: topicLabel(t), description: get(descKey) });
      }
    });
    var locations = [];
    LOCATIONS.forEach(function (pair) {
      if (isChecked(fields["Training Location " + pair[0]])) locations.push(pair[1]);
    });
    var delivery = get("VR Counselor approves all other AT training to be provided using the following delivery method");
    if (delivery && delivery.charAt(0) === "/") delivery = delivery.slice(1);
    var serviceRequested = get("Service Requested");
    /* Messy source files happen (Samuel's original 1884 literally stores
       "tRAININGAT Training"). If a canonical label is inside, prefer it. */
    if (serviceRequested) {
      var canonicalSvc = ["AT Baseline Assessment", "AT Post-Training Assessment", "AT Post-Assessment",
        "Assistive Technology Training", "Assistive Technology Assessment", "AT Training"];
      for (var ci = 0; ci < canonicalSvc.length; ci++) {
        if (serviceRequested.indexOf(canonicalSvc[ci]) >= 0) { serviceRequested = canonicalSvc[ci]; break; }
      }
    }
    return {
      referral: {
        serviceRequested: serviceRequested,
        date: get("Date of Referral"),
        trainerNamed: get("Trainer Name and Contractor Agency")
      },
      customer: {
        name: get("Customers Name"),
        dob: get("Customers date of birth"),
        phone: get("Customers Contact Number include area code"),
        altPhone: get("Alternate Contact Number include area code"),
        language: get("Customers Primary Language"),
        education: get("Level of Education"),
        goal: get("Customers Educational andor Vocational Goals"),
        diagnosis: get("Customer Visual Diagnosis"),
        acuityOD: get("O D right eye"),
        acuityOS: get("O S left eye"),
        visualFields: get("Visual Fields"),
        secondaryDisability: get("Customer Secondary Disability"),
        healthIssues: get("Known Health Issues Safety Concerns"),
        currentHardware: get("List the customers current hardware"),
        currentSoftware: get("List the customers current software"),
        notes: get("Other Additional Customer Information"),
        circumstances: get("Additional Information Regarding Circumstances that may Impact Services"),
        bestDaysToContact: get("Best Days to Contact Customer if any"),
        address: {
          street: get("Customer street address"),
          city: get("Customer City"),
          state: get("Customer State"),
          zip: get("Customer ZIP Code")
        }
      },
      counselor: {
        name: get("VR Counselor Name"),
        caseload: get("Caseload Number"),
        phone: get("Contact Number include area code")
      },
      training: {
        deliveryMethod: delivery,
        deliveryComments: get("Additional Service Delivery Methods Comments if any"),
        locations: locations,
        topics: topics,
        unknownTopicStates: unknownTopics
      }
    };
  }

  function find(text, re) {
    var m = text.match(re);
    return m ? clean(m[1]) : null;
  }
  /* pdf.js text extraction pads tokens with extra spaces and puts a space
     before colons ("VR Counselor :  Logan"). pypdf text is tighter. Normalize
     both to one form before label matching: collapse space runs (keep
     newlines) and remove space before colons. Phone numbers may also arrive
     as "(806) 555 - 0100", so phone patterns allow spaces around the dash. */
  var PHONE_RE = "((?:\\(\\d{3}\\)\\s*)?\\d{3}\\s*-\\s*\\d{4})";
  function normPhone(v) { return v ? v.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-") : v; }
  function normalizeText(text) {
    return String(text).replace(/[ \t]+/g, " ").replace(/ :/g, ":");
  }

  function parseSA(rawText) {
    var text = normalizeText(rawText);
    var auth = {
      number: find(text, /Service Authorization Number:\s*(\d+)/),
      caseId: find(text, /Case ID:\s*\n?\s*(\d+)/),
      customerName: find(text, /Customer Name:\s*\n?\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      contractNumber: find(text, /Contract Number:\s*(\S+)/),
      vendorNumber: find(text, /Vendor Number:\s*(\S+)/),
      dateIssued: find(text, /Date Issued:\s*([\d/]+)/),
      startDate: find(text, /Start Date:\s*([\d/]+)/),
      endDate: find(text, /End Date:\s*([\d/]+)/),
      totalCost: find(text, /Total Cost:\s*\$\s*([\d,]+)/)
    };
    var m = text.match(/TWC CCS Name\/Number:\s*\n?\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*?)\s*\/\s*(\d+)/u);
    if (m) { auth.counselorName = clean(m[1]); auth.counselorCaseload = clean(m[2]); }
    var office = {
      name: find(text, /Invoice To: Vocational Rehabilitation Services\s*\n([^\n]+)/),
      street: stripTrailingComma(find(text, /Invoice To: Vocational Rehabilitation Services\s*\n[^\n]+\n([^\n]+)/)),
      cityLine: find(text, /Invoice To: Vocational Rehabilitation Services\s*\n[^\n]+\n[^\n]+\n([^\n]+)/)
    };
    /* The VR2868 wants the counselor office city/state/ZIP as separate
       fields; the SA prints them as one line ("Lubbock, TX 79401"). */
    var cityParts = /^(.*?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec(office.cityLine || "");
    if (cityParts) {
      office.city = clean(cityParts[1]);
      office.state = cityParts[2].toUpperCase();
      office.zip = cityParts[3];
    }
    var twcContact = {
      name: find(text, /TWC Contact Name:\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      phone: normPhone(find(text, new RegExp("Contact Phone No:\\s*" + PHONE_RE))),
      email: find(text, /Contact Email:\s*(\S+)/)
    };
    var items = [];
    var re = /^\d+\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(Each|Hour)\s+\$\s*([\d,]+)\s+\$\s*([\d,]+)/gm;
    var im;
    while ((im = re.exec(text)) !== null) {
      items.push({ description: clean(im[1]), qty: im[2], unit: im[3], unitCost: im[4], totalCost: im[5] });
    }
    return { authorization: auth, officeFromSA: office, twcContact: twcContact, lineItems: items };
  }

  function parseEAS(rawText) {
    var text = normalizeText(rawText);
    return { eas: {
      reportFor: find(text, /EAS Consultation Report for:\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      consultDate: find(text, /Consultation Date:\s*([\d/]+)/),
      caseId: find(text, /Case ID:\s*(\d+)/),
      vrc: find(text, /VR Counselor:\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      easName: find(text, /EAS Initial Consultation Report Prepared by:\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      goal: find(text, /Vocational \(IPE\) Goal:\s*([^\n]+)/),
      visualDisability: find(text, /Visual Disability:\s*([^\n]+)/),
      acuityOD: find(text, /Visual Acuities OD:\s*(\S+)/),
      acuityOS: find(text, /Visual Acuities OS:\s*(\S+)/),
      secondaryDisability: find(text, /Secondary Disability:\s*([^\n]+)/),
      fieldRestrictionOD: find(text, /Field Restriction OD:\s*([^\n]+)/),
      fieldRestrictionOS: find(text, /Field Restriction OS:\s*([^\n]+)/),
      /* Recommendation signals for suggested VR2902 subjects: the products
         the EAS consultant checked (lines beginning with the X mark), the
         "determine training needs in ..." sentence, and any OCR-software
         mention in the evaluations. */
      checkedItems: (function () {
        var items = [];
        text.split("\n").forEach(function (line) {
          var mm = line.match(/^\s*X\s+(.+?)\s*$/);
          if (mm) items.push(clean(mm[1].replace(/\s*Notes:.*$/, "")));
        });
        return items;
      })(),
      trainingNeedsText: find(text, /determine training needs in ([^.]+)\./),
      ocrSoftware: /OCR software/i.test(text),
      homeHardware: find(text, /Technology at home\s*\nHardware:\s*([^\n]+)/),
      homeSoftware: find(text, /Technology at home\s*\nHardware:[^\n]*\nSoftware:\s*([^\n]+)/),
      office: {
        name: find(text, /Current Office Information\s*\nName:\s*([^\n]+)/),
        phone: normPhone(find(text, new RegExp("Current Office Information[\\s\\S]*?Phone:\\s*" + PHONE_RE)))
      }
    }};
  }

  function subjectsFor(topics) {
    var subjects = {}, notes = [];
    topics.forEach(function (t) {
      var desc = t.description || "";
      if (t.topic.indexOf("Screen Readers") === 0) {
        if (/jaws|screen reader/i.test(desc)) subjects["Screen Reader"] = true;
        if (/zoomtext|magnif/i.test(desc)) subjects["Screen Magnification"] = true;
        if (!/jaws|screen reader|zoomtext|magnif/i.test(desc))
          notes.push("Combined screen reader/magnification topic with unclear description: \"" + desc + "\"");
      }
      else if (t.topic === "The Word Processor") subjects["Microsoft Word"] = true;
      else if (t.topic === "Key Boarding Skills") subjects["Keyboard Knowledge"] = true;
      else if (t.topic === "The Internet and the World Wide Web") subjects["Internet"] = true;
      else if (t.topic === "Viewing and Creating Spreadsheets using Microsoft Excel") subjects["Microsoft Excel"] = true;
      else if (t.topic.indexOf("OCR Software") === 0) subjects["Optical Character Recognition"] = true;
      else if (t.topic === "Braille Note Takers") subjects["Notetaker"] = true;
      else if (t.topic === "Operating Feature Function and Maintenance") subjects["Microsoft Windows"] = true;
      else if (t.topic === "Computer Skills and Mobile Operating System Skills Post Training Assessments") { /* signals post 2902 */ }
      else notes.push("No 2902 subject exists for topic: " + t.label + " (objective text only)");
    });
    return { subjects: Object.keys(subjects).sort(), notes: notes };
  }

  /* Any subset of the three documents may be submitted. A null/undefined
     argument means that document was NOT submitted: parsing runs on what is
     present, cross-document conflict checks only compare documents that are
     both present (every check below already guards on both sides having a
     value), and derived.missingDocuments names the absent pieces so the
     readout can list them for the counselor. */
  function buildRecord(fields1884, saText, easText) {
    var record = {};
    var missingDocuments = [];
    if (fields1884 === null || fields1884 === undefined) missingDocuments.push("VR1884 Referral");
    if (saText === null || saText === undefined) missingDocuments.push("Service Authorization (SA)");
    if (easText === null || easText === undefined) missingDocuments.push("EAS Consultation Report");
    var a = parse1884(fields1884 || {}); Object.assign(record, a);
    if (saText) Object.assign(record, parseSA(saText));
    if (easText) Object.assign(record, parseEAS(easText));
    record.authorization = record.authorization || {};
    record.lineItems = record.lineItems || [];
    record.eas = record.eas || {};

    var conflicts = [];
    var c = record.customer, e = record.eas;
    if (c.currentHardware && e.homeHardware && e.homeHardware !== "N/A" &&
        c.currentHardware.toLowerCase().indexOf(e.homeHardware.toLowerCase()) === -1 &&
        e.homeHardware.toLowerCase().indexOf(c.currentHardware.toLowerCase()) === -1)
      conflicts.push("Hardware: 1884 says \"" + c.currentHardware + "\", EAS (older) says \"" + e.homeHardware + "\" at home");
    if (record.authorization.caseId && e.caseId && record.authorization.caseId !== e.caseId)
      conflicts.push("Case ID mismatch between SA and EAS");
    [["Customer name", c.name, record.authorization.customerName],
     ["Counselor", record.counselor.name, record.authorization.counselorName],
     ["Caseload", record.counselor.caseload, record.authorization.counselorCaseload]
    ].forEach(function (row) {
      if (row[1] && row[2] && row[1].trim().toLowerCase() !== row[2].trim().toLowerCase())
        conflicts.push(row[0] + ": 1884 \"" + row[1] + "\" vs SA \"" + row[2] + "\"");
    });

    /* Multi-source harvesting with provenance (Fernando's rule: check
       every document for every fact, and label each fact with the document
       it came from). Priority: the 1884 is authoritative for customer and
       counselor facts; the SA supplies authorization data plus counselor
       name/caseload when the 1884 is silent; the EAS gap-fills what
       neither has. Runs AFTER the conflict checks above, which compare the
       raw sources, so a harvested value can never mask a disagreement.
       One deliberate exception: the counselor's PHONE is never taken from
       the SA — the SA's contact number belongs to the TWC office contact,
       not the counselor. */
    var sources = { customer: {}, counselor: {} };
    Object.keys(c).forEach(function (k) {
      if (k !== "address" && c[k]) sources.customer[k] = "VR1884";
    });
    if (c.address && (c.address.street || c.address.city || c.address.zip)) sources.customer.address = "VR1884";
    if (record.counselor.name) sources.counselor.name = "VR1884";
    if (record.counselor.caseload) sources.counselor.caseload = "VR1884";
    if (record.counselor.phone) sources.counselor.phone = "VR1884";
    var gapFilled = [];
    function fillField(obj, key, label, value, srcMap, srcName) {
      if (value) { obj[key] = value; gapFilled.push(label); if (srcMap) srcMap[key] = srcName || "EAS"; }
    }
    if (!c.diagnosis) fillField(c, "diagnosis", "visual diagnosis", e.visualDisability, sources.customer);
    if (!c.acuityOD) fillField(c, "acuityOD", "acuity OD", e.acuityOD, sources.customer);
    if (!c.acuityOS) fillField(c, "acuityOS", "acuity OS", e.acuityOS, sources.customer);
    if (!c.visualFields) {
      var vfParts = [];
      if (e.fieldRestrictionOD && e.fieldRestrictionOD !== "N/A") vfParts.push("OD: " + e.fieldRestrictionOD);
      if (e.fieldRestrictionOS && e.fieldRestrictionOS !== "N/A") vfParts.push("OS: " + e.fieldRestrictionOS);
      if (vfParts.length) { c.visualFields = vfParts.join("; "); gapFilled.push("visual fields"); sources.customer.visualFields = "EAS"; }
    }
    if (!c.goal) fillField(c, "goal", "vocational goal", e.goal, sources.customer);
    if (!c.secondaryDisability) fillField(c, "secondaryDisability", "secondary disability", e.secondaryDisability, sources.customer);
    if (!c.currentHardware && e.homeHardware && e.homeHardware !== "N/A")
      fillField(c, "currentHardware", "current hardware", e.homeHardware, sources.customer);
    if (!c.currentSoftware && e.homeSoftware && e.homeSoftware !== "N/A")
      fillField(c, "currentSoftware", "current software", e.homeSoftware, sources.customer);
    if (!c.name) {
      if (record.authorization.customerName) fillField(c, "name", "customer name", record.authorization.customerName, sources.customer, "SA");
      else if (e.reportFor) fillField(c, "name", "customer name", e.reportFor, sources.customer, "EAS");
    }
    if (!record.counselor.name) {
      if (record.authorization.counselorName) fillField(record.counselor, "name", "counselor name", record.authorization.counselorName, sources.counselor, "SA");
      else if (e.vrc) fillField(record.counselor, "name", "counselor name", e.vrc, sources.counselor, "EAS");
    }
    if (!record.counselor.caseload && record.authorization.counselorCaseload)
      fillField(record.counselor, "caseload", "counselor caseload", record.authorization.counselorCaseload, sources.counselor, "SA");
    record.sources = sources;
    var caseIdSources = [];
    if (record.authorization.caseId) caseIdSources.push("SA");
    if (e.caseId) caseIdSources.push("EAS");

    /* Suggested VR2902 subjects from the EAS recommendations — suggestions
       only. The 1884's topics decide the real list (subjects2902); these
       exist for packets where the 1884 is missing or silent, and every
       suggestion carries the EAS signal it came from. */
    var sugg = {}, suggNotes = [];
    function suggest(subject, reason) { if (!sugg[subject]) sugg[subject] = reason; }
    (e.checkedItems || []).forEach(function (item) {
      if (/fusion/i.test(item)) {
        suggest("Screen Reader", "Fusion checked on the EAS");
        suggest("Screen Magnification", "Fusion checked on the EAS");
      } else if (/jaws/i.test(item)) suggest("Screen Reader", "JAWS checked on the EAS");
      else if (/zoomtext/i.test(item)) suggest("Screen Magnification", "ZoomText checked on the EAS");
    });
    if (e.trainingNeedsText) {
      e.trainingNeedsText.split(/,| and /).map(function (s) { return s.trim(); }).filter(Boolean)
        .forEach(function (need) {
          if (/excel|spreadsheet/i.test(need)) suggest("Microsoft Excel", "EAS training need: " + need);
          else if (/internet/i.test(need)) suggest("Internet", "EAS training need: " + need);
          else if (/computer access/i.test(need)) suggest("Microsoft Windows", "EAS training need: " + need);
          else if (/microsoft word|\bword\b/i.test(need)) suggest("Microsoft Word", "EAS training need: " + need);
          else suggNotes.push("No VR2902 subject exists for EAS training need: " + need + " (objective text only)");
        });
    }
    if (e.ocrSoftware) suggest("Optical Character Recognition", "EAS evaluations mention OCR software");
    var suggestedSubjects = Object.keys(sugg).sort().map(function (s) { return { subject: s, reason: sugg[s] }; });

    var subj = subjectsFor(record.training.topics);
    var docs = [];
    record.lineItems.forEach(function (i) {
      if (/Baseline/i.test(i.description)) docs.push("VR2902 Baseline");
      if (/Post/i.test(i.description)) docs.push("VR2902 Post-Training");
      if (/Training/i.test(i.description) && !/Assessment/i.test(i.description)) docs.push("VR2868");
    });
    record.derived = {
      subjects2902: subj.subjects,
      subjectNotes: subj.notes,
      documentsToGenerate: docs,
      /* SA funds a post-training assessment but no baseline: flag it for
         the counselor (baseline may exist under an earlier SA — request
         the copy; if none exists, ask about authorizing one BEFORE the
         training runs). Fernando's call, 2026-11-02. */
      baselineGap: docs.indexOf("VR2902 Post-Training") !== -1 && docs.indexOf("VR2902 Baseline") === -1,
      conflicts: conflicts,
      missingDocuments: missingDocuments,
      easGapFilled: gapFilled,
      caseIdSources: caseIdSources,
      suggestedSubjects: suggestedSubjects,
      suggestionNotes: suggNotes
    };
    return record;
  }

  var api = { parse1884: parse1884, parseSA: parseSA, parseEAS: parseEAS, subjectsFor: subjectsFor, buildRecord: buildRecord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PacketBridgeExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
