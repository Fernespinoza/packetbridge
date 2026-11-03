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
    /* The Other location's checkbox breaks the "Training Location " prefix
       pattern, so it is read on its own, with its description field. */
    var otherLocDesc = get("Description of Other Training Location");
    if (isChecked(fields["Other Training Location specify"]) || otherLocDesc)
      locations.push(otherLocDesc ? "Other: " + otherLocDesc : "Other (marked on the 1884, no description)");
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
        trainerNamed: get("Trainer Name and Contractor Agency"),
        atEvalProvided: isChecked(fields["Assistive Technology Evaluation Report if applicable Provided by TWCVR at Referral"]),
        otherInfoProvided: isChecked(fields["Other Additional Information Provided by TWCVR at Referral"]),
        otherInfoDescription: get("Description of Other Additional Information Provided by TWCVR at Referral")
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
        primaryCommunication: get("If secondary disability is deaf blindness what is the customers primary form of communication"),
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
  /* pdf.js pads hyphens with spaces ("55 - A45W7"); IDs read as one value. */
  function idValue(v) { return v ? v.replace(/\s*-\s*/g, "-") : v; }
  /* An empty email field makes \S+ swallow the next label ("Contact");
     a value with no @ is not an email address. */
  function emailValue(v) { return v && /@/.test(v) ? v : null; }
  function normalizeText(text) {
    return String(text).replace(/[ \t]+/g, " ").replace(/ :/g, ":");
  }

  function parseSA(rawText) {
    var text = normalizeText(rawText);
    var auth = {
      number: find(text, /Service Authorization Number:\s*(\d+)/),
      caseId: find(text, /Case ID:\s*\n?\s*(\d+)/),
      customerName: find(text, /Customer Name:\s*\n?\s*([\p{L}'’.\-]+(?: [\p{L}'’.\-]+)*)/u),
      contractNumber: idValue(find(text, /Contract Number:\s*([A-Za-z0-9]+(?:\s*-\s*[A-Za-z0-9]+)*)/)),
      vendorNumber: idValue(find(text, /Vendor Number:\s*([A-Za-z0-9]+(?:\s*-\s*[A-Za-z0-9]+)*)/)),
      dateIssued: find(text, /Date Issued:\s*([\d/]+)/),
      startDate: find(text, /Start Date:\s*([\d/]+)/),
      endDate: find(text, /End Date:\s*([\d/]+)/),
      totalCost: find(text, /Total Cost:\s*\$\s*([\d,]+)/),
      deliveryInstructions: find(text, /Delivery Instructions:\s*([^\n]+)/)
    };
    /* The SA's delivery instructions sometimes name who must deliver the
       training ("provided by ..."). Surface that name so the readout can
       flag it when it is not the trainer in the provider profile. A mere
       "Per VR1884 dated ..." line names nobody and yields null. */
    var diBy = auth.deliveryInstructions &&
      /\b(?:provided|delivered|conducted|performed) by\s+([^.;]+)/i.exec(auth.deliveryInstructions);
    auth.instructionsTrainer = diBy ? clean(diBy[1].replace(/\s+dated.*$/i, "")) : null;
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
      email: emailValue(find(text, /Contact Email:\s*(\S+)/))
    };
    var items = [];
    var re = /^\d+\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(Each|Hour)\s+\$\s*([\d,]+)\s+\$\s*([\d,]+)/gm;
    var im;
    while ((im = re.exec(text)) !== null) {
      items.push({ description: clean(im[1]).replace(/\s+-\s+/g, "-"), qty: im[2], unit: im[3], unitCost: im[4], totalCost: im[5] });
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
  function buildRecord(fields1884, saText, easText, flat1884, todayStr) {
    var record = {};
    var missingDocuments = [];
    if ((fields1884 === null || fields1884 === undefined) && !flat1884) missingDocuments.push("VR1884 Referral");
    if (saText === null || saText === undefined) missingDocuments.push("Service Authorization (SA)");
    if (easText === null || easText === undefined) missingDocuments.push("EAS Consultation Report");
    var a = flat1884 || parse1884(fields1884 || {}); Object.assign(record, a);
    /* A fillable 1884 with nothing filled in is a different problem from a
       missing one: it loads fine but says nothing. Detect and say so. */
    var referralBlank = !flat1884 && fields1884 !== null && fields1884 !== undefined &&
      !a.customer.name && !a.counselor.name && !(a.training.topics || []).length && !a.training.deliveryMethod;
    if (saText) Object.assign(record, parseSA(saText));
    if (easText) Object.assign(record, parseEAS(easText));
    record.authorization = record.authorization || {};
    record.lineItems = record.lineItems || [];
    record.eas = record.eas || {};

    var conflicts = [];
    var c = record.customer, e = record.eas;
    /* Hardware wording differs between forms ("Android phone" vs "Android
       smart phone") — compare word overlap, not exact strings, and flag
       only when the two descriptions barely overlap. */
    if (c.currentHardware && e.homeHardware && e.homeHardware !== "N/A") {
      var hwSet = function (t) { var o = {}; String(t).toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) { if (w) o[w] = true; }); return o; };
      var hwA = hwSet(c.currentHardware), hwB = hwSet(e.homeHardware);
      var hwShared = Object.keys(hwA).filter(function (w) { return hwB[w]; }).length;
      var hwMin = Math.min(Object.keys(hwA).length, Object.keys(hwB).length);
      if (hwMin && hwShared / hwMin < 0.5)
        conflicts.push("Hardware: 1884 says \"" + c.currentHardware + "\", EAS (older) says \"" + e.homeHardware + "\" at home");
    }
    if (record.authorization.caseId && e.caseId && record.authorization.caseId !== e.caseId)
      conflicts.push("Case ID mismatch between SA and EAS");
    [["Customer name", c.name, record.authorization.customerName],
     ["Counselor", record.counselor.name, record.authorization.counselorName],
     ["Caseload", record.counselor.caseload, record.authorization.counselorCaseload]
    ].forEach(function (row) {
      if (row[1] && row[2] && row[1].trim().toLowerCase() !== row[2].trim().toLowerCase())
        conflicts.push(row[0] + ": 1884 \"" + row[1] + "\" vs SA \"" + row[2] + "\"");
    });

    /* The remaining cross-checks (Fernando, 2026-11-02): diagnosis,
       vocational goal, software, and visual fields compare by word
       overlap like hardware does — rephrasings are not conflicts — while
       the acuities compare exactly once spacing is normalized. */
    function wordSet(t) { var o = {}; String(t).toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) { if (w) o[w] = true; }); return o; }
    function barelyOverlap(a, b) {
      var A = wordSet(a), B = wordSet(b);
      var shared = Object.keys(A).filter(function (w) { return B[w]; }).length;
      var min = Math.min(Object.keys(A).length, Object.keys(B).length);
      return min > 0 && shared / min < 0.5;
    }
    /* "Unknown" is a non-answer, not a competing claim (Samuel's EAS
       lists the home software as "Unknown" while the 1884 names JAWS). */
    function naLike(v) { return !v || /^n\/?a$/i.test(String(v).trim()) || /^unknown$/i.test(String(v).trim()); }
    function textConflict(label, aVal, bVal) {
      if (naLike(aVal) || naLike(bVal)) return;
      if (String(aVal).trim().toLowerCase() === String(bVal).trim().toLowerCase()) return;
      if (barelyOverlap(aVal, bVal))
        conflicts.push(label + ": 1884 says \"" + aVal + "\", EAS says \"" + bVal + "\"");
    }
    textConflict("Diagnosis", c.diagnosis, e.visualDisability);
    textConflict("Vocational goal", c.goal, e.goal);
    textConflict("Software", c.currentSoftware, e.homeSoftware);
    var easFieldParts = [e.fieldRestrictionOD, e.fieldRestrictionOS].filter(function (v) { return v && !naLike(v); });
    var easFields = null;
    if (easFieldParts.length === 2 && easFieldParts[0] !== easFieldParts[1])
      easFields = "OD: " + easFieldParts[0] + "; OS: " + easFieldParts[1];
    else if (easFieldParts.length) easFields = easFieldParts[0];
    textConflict("Visual fields", c.visualFields, easFields);
    [["Visual acuity OD", c.acuityOD, e.acuityOD], ["Visual acuity OS", c.acuityOS, e.acuityOS]].forEach(function (row) {
      if (naLike(row[1]) || naLike(row[2])) return;
      if (String(row[1]).toLowerCase().replace(/\s+/g, "") !== String(row[2]).toLowerCase().replace(/\s+/g, ""))
        conflicts.push(row[0] + ": 1884 says \"" + row[1] + "\", EAS says \"" + row[2] + "\"");
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

    /* Date checks (Fernando's rule, first noted 2026-10-29, confirmed
       2026-11-02): surface the documents' dates, flag an SA whose window
       has not started or has ended, and flag any document more than 6
       months older than the SA. "Today" is injectable for tests. */
    function parseMDY(v) {
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || "").trim());
      return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : null;
    }
    var todayMs = parseMDY(todayStr);
    if (todayMs === null) { var nowD = new Date(); todayMs = Date.UTC(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()); }
    var DAY_MS = 86400000;
    var saStartMs = parseMDY(record.authorization.startDate);
    var saEndMs = parseMDY(record.authorization.endDate);
    var saStatus = "unknown";
    if (missingDocuments.indexOf("Service Authorization (SA)") !== -1) saStatus = "no-sa";
    else if (saEndMs !== null && todayMs > saEndMs) saStatus = "expired";
    else if (saStartMs !== null && todayMs < saStartMs) saStatus = "not-yet";
    else if (saStartMs !== null || saEndMs !== null) saStatus = "current";
    var dateFlags = [];
    if (saStatus === "expired")
      dateFlags.push({ kind: "sa-expired", text: "⚠ Date check: this SA expired on " + record.authorization.endDate + " — sessions after that date are not authorized under it." });
    if (saStatus === "not-yet")
      dateFlags.push({ kind: "sa-not-yet", text: "⚠ Date check: this SA does not start until " + record.authorization.startDate + " — sessions before that date are not authorized under it." });
    var saRefMs = parseMDY(record.authorization.dateIssued) || saStartMs;
    [["EAS", e.consultDate, "eas"], ["VR1884", record.referral.date, "referral"]].forEach(function (row) {
      var docMs = parseMDY(row[1]);
      if (docMs !== null && saRefMs !== null && (saRefMs - docMs) / DAY_MS > 183)
        dateFlags.push({ kind: "stale-" + row[2], text: "⚠ Date check: the " + row[0] + " is dated " + row[1] + " — more than 6 months older than the SA (issued " + (record.authorization.dateIssued || record.authorization.startDate) + "). Information that old may no longer match the customer's situation; confirm it is still current." });
    });
    /* Authorized hours from the SA line items (the details form checks
       planned session hours against these). */
    var saHoursTraining = 0, saHoursAll = 0;
    record.lineItems.forEach(function (i) {
      if (i.unit !== "Hour") return;
      var h = parseFloat(i.qty) || 0;
      saHoursAll += h;
      if (/Training/i.test(i.description) && !/Assessment/i.test(i.description)) saHoursTraining += h;
    });

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
      referralBlank: referralBlank,
      referralFlattened: !!flat1884,
      dateFlags: dateFlags,
      saStatus: saStatus,
      docDates: { eas: e.consultDate || null, referral: record.referral.date || null, saIssued: record.authorization.dateIssued || null },
      saHours: { training: saHoursTraining, allHours: saHoursAll },
      conflicts: conflicts,
      missingDocuments: missingDocuments,
      easGapFilled: gapFilled,
      caseIdSources: caseIdSources,
      suggestedSubjects: suggestedSubjects,
      suggestionNotes: suggNotes
    };
    return record;
  }

  /* Flattened VR1884 — the TWC system print layout ("vr1884-twc" files):
     the filled form rendered to plain positioned text, no AcroForm fields.
     Layout rules of this print (verified against a real print, 2026-11-02):
     page 1 prints label rows with the values ~10pt BELOW each label row,
     in columns under their labels; page 2 prints checkbox options with a
     ■ glyph beside the chosen ones, and topic descriptions just after
     each topic label. Input is positioned items per page:
     [{items: [{str, x, y, w}]}]. Returns the same shape as parse1884, or
     null when the layout anchors are absent. Values the print leaves
     blank — including its "N/A" placeholders — come back null, so the
     readout reports them missing instead of guessed. */
  function parseFlat1884(pages) {
    if (!pages || !pages.length) return null;
    function nz(s) { return String(s == null ? "" : s).replace(/’/g, "'").replace(/\s+/g, " ").trim(); }
    function naVal(v) { v = nz(v); return v && !/^n\/?a$/i.test(v) ? v : null; }
    function findLabel(items, prefix, minY) {
      var want = nz(prefix).toLowerCase();
      for (var i = 0; i < items.length; i++) {
        if (nz(items[i].str).toLowerCase().indexOf(want) === 0 && (minY === undefined || items[i].y >= minY)) return items[i];
      }
      return null;
    }

    /* ---- page 1: label rows, values below, columns by label x ---- */
    var p1 = (pages[0] && pages[0].items) || [];
    if (!findLabel(p1, "VR Counselor Name:") || !findLabel(p1, "Customer's Name:")) return null;
    var rows1 = [
      [["serviceRequested", "Service Requested:"]],
      [["counselorName", "VR Counselor Name:"], ["counselorCaseload", "Caseload Number:"], ["counselorPhone", "Contact Number"]],
      [["trainerNamed", "Trainer Name and Contractor Agency:"], ["referralDate", "Date of Referral:"]],
      [["custName", "Customer's Name:"], ["dob", "Customer's date of birth"], ["language", "Customer's Primary Language:"]],
      [["street", "Customer's street address:"], ["city", "City:"], ["state", "State:"], ["zip", "ZIP Code:"]],
      [["phone", "Customer's Contact Number"], ["altPhone", "Alternate Contact Number"]],
      [["bestDays", "Best Day(s) to Contact"]],
      [["goal", "Customer's Educational and/or Vocational Goal(s):"]],
      [["diagnosis", "Visual Diagnosis:"]],
      [["__skip", "Visual Acuity:"], ["acuityOD", "O D (right eye):"], ["acuityOS", "O S (left eye):"], ["visualFields", "Visual Fields:"]],
      [["notes", "Other Additional Information:"]],
      [["secondary", "Secondary Disability:"]],
      [["primaryComm", "If secondary disability is deaf blindness"]],
      [["education", "Level of Education:"], ["health", "Known Health Issues"]],
      [["circumstances", "Additional Information:"]],
      [["hardware", "List the customer's current hardware:"]],
      [["software", "List the customer's current software:"]]
    ];
    var labelItems = new Set();
    var rowDefs = [];
    rows1.forEach(function (cols) {
      var found = [];
      cols.forEach(function (c) {
        var it = findLabel(p1, c[1]);
        if (it) { labelItems.add(it); found.push({ key: c[0], item: it }); }
      });
      if (found.length) rowDefs.push(found);
    });
    var vals = {};
    p1.forEach(function (it) {
      if (labelItems.has(it) || !nz(it.str)) return;
      var best = null, bestD = 1e9;
      rowDefs.forEach(function (cols) {
        var d = cols[0].item.y - it.y;
        if (d >= 3 && d <= 16 && d < bestD) { bestD = d; best = cols; }
      });
      if (!best) return;
      var col = best[0];
      if (best.length > 1) {
        col = best[best.length - 1];
        for (var j = 0; j < best.length - 1; j++) {
          if (it.x < (best[j].item.x + best[j + 1].item.x) / 2) { col = best[j]; break; }
        }
      }
      (vals[col.key] = vals[col.key] || []).push(it);
    });
    function val(key) {
      var arr = vals[key];
      if (!arr) return null;
      arr.sort(function (a, b) { return a.x - b.x; });
      return naVal(arr.map(function (i) { return i.str; }).join(" "));
    }

    /* ---- page 2: ■-marked choices, descriptions after labels ---- */
    var p2 = (pages[1] && pages[1].items) || [];
    var p2Labels = new Set();
    p2.forEach(function (it) { if (nz(it.str) === "■") p2Labels.add(it); });
    function regLabel(it) { if (it) p2Labels.add(it); return it; }
    function checkedNear(labelItem) {
      if (!labelItem) return false;
      return p2.some(function (it) {
        /* the mark sits ~20pt left of ITS label — a mark from the other
           column (or another row's) must not count */
        return nz(it.str) === "■" && it.x < labelItem.x && labelItem.x - it.x <= 30 && Math.abs(it.y - labelItem.y) <= 4;
      });
    }
    function descAfter(labelItem) {
      if (!labelItem) return null;
      var endX = labelItem.x + (labelItem.w || 0);
      var cands = p2.filter(function (it) {
        return !p2Labels.has(it) && nz(it.str) && nz(it.str) !== ":" && it.x >= endX - 2 &&
          it.y >= labelItem.y - 7 && it.y <= labelItem.y + 15;
      });
      cands.sort(function (a, b) { return a.x - b.x; });
      return naVal(cands.map(function (i) { return i.str; }).join(" "));
    }

    var TOPIC_BY_NORM = {};
    /* punctuation-insensitive matching: the print writes "stand-alone"
       where the form field says "standalone", commas everywhere, etc. */
    function normKey(t) { return nz(t).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
    TOPICS.forEach(function (t) { TOPIC_BY_NORM[normKey(t)] = t; });
    var topicStarts = ["Key Boarding Skills", "Setting up the Workstation", "Operating Feature",
      "Screen Readers", "The Word Processor", "The Internet and the World Wide Web",
      "Viewing and Creating Microsoft PowerPoint", "Viewing and Creating Spreadsheets",
      "OCR Software", "Braille Note Takers", "Mobile Operating Systems",
      "Computer Skills and Mobile Operating System Skills"];
    var topics = [];
    topicStarts.forEach(function (start) {
      var first = findLabel(p2, start);
      if (!first) return;
      regLabel(first);
      /* a wrapped label's second line sits ~14pt below at the same x */
      var cont = null;
      p2.forEach(function (it) {
        if (it !== first && Math.abs(it.x - first.x) <= 4 && first.y - it.y >= 8 && first.y - it.y <= 18 &&
            topicStarts.every(function (s2) { return nz(it.str).toLowerCase().indexOf(nz(s2).toLowerCase()) !== 0; }))
          cont = it;
      });
      if (cont) regLabel(cont);
      var labelText = nz(first.str) + (cont ? " " + nz(cont.str) : "");
      var key = TOPIC_BY_NORM[normKey(labelText)];
      if (!key) { /* a wrapped label read in part still maps to its topic */
        var ln = normKey(labelText);
        Object.keys(TOPIC_BY_NORM).forEach(function (k) {
          if (!key && (k.indexOf(ln) === 0 || ln.indexOf(k) === 0)) key = TOPIC_BY_NORM[k];
        });
      }
      if (!key) return;
      var desc = descAfter(cont || first);
      if (checkedNear(first) || desc) topics.push({ topic: key, label: topicLabel(key), description: desc || "" });
    });
    var otherTopicLabel = null;
    p2.forEach(function (it) { if (nz(it.str) === "Other:" && it.y > 400) otherTopicLabel = it; });
    if (otherTopicLabel) {
      regLabel(otherTopicLabel);
      var otherDesc = descAfter(otherTopicLabel);
      if (checkedNear(otherTopicLabel) || otherDesc)
        topics.push({ topic: "Other Training Topics", label: topicLabel("Other Training Topics"), description: otherDesc || "" });
    }

    var delivery = null;
    [["Only in-person"], ["Only remotely"], ["In person and/or remote as dependent on customer"]].forEach(function (o) {
      var it = regLabel(findLabel(p2, o[0]));
      if (it && checkedNear(it)) delivery = nz(it.str).replace("in-person", "in person");
    });
    if (delivery && delivery.indexOf("In person and/or remote") === 0)
      delivery = "In person and/or remote as dependent on customer's needs";

    var locations = [];
    [["Customer's home/family home", "Customer's home / family home"],
     ["Customer's work site", "Customer's work site"],
     ["Customer's school or vocational training site", "Customer's school / vocational training site"],
     ["AT service provider's facility", "AT service provider's facility"],
     ["Unknown", "Unknown"]].forEach(function (pair) {
      var it = regLabel(findLabel(p2, pair[0]));
      if (it && checkedNear(it)) locations.push(pair[1]);
    });
    var otherLoc = regLabel(findLabel(p2, "Other (specify):"));
    if (otherLoc && checkedNear(otherLoc)) {
      var od = descAfter(otherLoc);
      locations.push(od ? "Other: " + od : "Other (marked on the 1884, no description)");
    }

    var atEval = regLabel(findLabel(p2, "Assistive Technology Evaluation Report, if applicable"));
    var refOther = null;
    p2.forEach(function (it) { if (nz(it.str) === "Other:" && it.y <= 400) refOther = it; });
    regLabel(refOther);
    var commentsLabel = regLabel(findLabel(p2, "Additional Comments, if any"));

    return {
      referral: {
        serviceRequested: val("serviceRequested"),
        date: val("referralDate"),
        trainerNamed: val("trainerNamed"),
        atEvalProvided: checkedNear(atEval),
        otherInfoProvided: checkedNear(refOther),
        otherInfoDescription: descAfter(refOther)
      },
      customer: {
        name: val("custName"),
        dob: val("dob"),
        phone: normPhone(val("phone")),
        altPhone: normPhone(val("altPhone")),
        language: val("language"),
        education: val("education"),
        goal: val("goal"),
        diagnosis: val("diagnosis"),
        acuityOD: val("acuityOD"),
        acuityOS: val("acuityOS"),
        visualFields: val("visualFields"),
        secondaryDisability: val("secondary"),
        primaryCommunication: val("primaryComm"),
        healthIssues: val("health"),
        currentHardware: val("hardware"),
        currentSoftware: val("software"),
        notes: val("notes"),
        circumstances: val("circumstances"),
        bestDaysToContact: val("bestDays"),
        address: { street: val("street"), city: val("city"), state: val("state"), zip: val("zip") }
      },
      counselor: {
        name: val("counselorName"),
        caseload: val("counselorCaseload"),
        phone: normPhone(val("counselorPhone"))
      },
      training: {
        deliveryMethod: delivery,
        deliveryComments: descAfter(commentsLabel),
        locations: locations,
        topics: topics,
        unknownTopicStates: []
      }
    };
  }

  /* The counselor-facing summary of a readout: every missing item and
     every inconsistency, phrased as the questions to ask — the list that
     goes in the email or gets read out on the call. Facts a missing
     VR1884 would answer (names, phone numbers — the 1884 is their only
     source) are not asked separately; the send-the-1884 question covers
     them. Added at Fernando's direction, 2026-11-02. */
  function questionFromConflict(c) {
    if (/^Case ID mismatch/.test(c))
      return "Please confirm the correct Case ID — the SA and the EAS disagree.";
    var s = String(c)
      .replace(/1884 says/g, "the VR1884 says")
      .replace(/EAS \(older\) says/g, "the EAS says")
      .replace(/: 1884 "/g, ": the VR1884 says \"")
      .replace(/ vs SA "/g, " but the SA says \"")
      .replace(/ vs EAS "/g, " but the EAS says \"")
      .replace(/, EAS says/g, " but the EAS says");
    return "Please confirm which is correct — " + s;
  }

  function counselorQuestions(record, opts) {
    opts = opts || {};
    var groups = { counselor: [], issuer: [], customer: [] };
    var d = record.derived || {};
    var missing = d.missingDocuments || [];
    missing.forEach(function (doc) { groups.counselor.push("Please send the missing " + doc + "."); });
    if (d.referralBlank)
      groups.counselor.push("Please send the completed VR1884 Referral — the copy in this packet is blank.");
    var prereqs = opts.prereqs || {};
    if (d.baselineGap && !prereqs.baselineCopyReceived)
      groups.counselor.push("Was a baseline VR2902 already completed (possibly under an earlier SA)? If so, please send a copy — the post-training assessment should re-test the same subjects and tasks. If not, should a baseline be authorized before training begins?");
    (d.dateFlags || []).forEach(function (f) {
      if (f.kind === "sa-expired")
        groups.issuer.push("This SA expired on " + record.authorization.endDate + " — will a new authorization be issued, or will this one be extended?");
      else if (f.kind === "sa-not-yet")
        groups.issuer.push("This SA does not start until " + record.authorization.startDate + " — please confirm the start date is correct.");
      else if (f.kind === "stale-eas")
        groups.counselor.push("The EAS is dated " + record.eas.consultDate + " — more than 6 months older than this SA. Are its recommendations still current?");
      else if (f.kind === "stale-referral")
        groups.counselor.push("The VR1884 is dated " + record.referral.date + " — more than 6 months older than this SA. Is the referral information still current?");
    });
    var noRef = missing.indexOf("VR1884 Referral") !== -1 || !!d.referralBlank;
    if (!noRef) {
      if (!record.customer.name) groups.counselor.push("What is the customer's full name? None of the documents in this packet give it.");
      if (!record.counselor.name) groups.counselor.push("Who is the VR counselor for this case? The packet does not name one.");
      if (!record.counselor.phone) groups.counselor.push("What is the counselor's phone number? It is not in this packet.");
      if (!record.training.deliveryMethod) groups.counselor.push("Which delivery method is approved for this training (in person, remote, or a mix)? The packet does not say.");
      if (!record.training.locations || !record.training.locations.length)
        groups.counselor.push("Where should the training take place? No training location is marked in this packet.");
    }
    /* The customer's own questions — asked directly at first contact. */
    if (!record.customer.phone) groups.customer.push("What is the best phone number to reach you? It is not in this packet.");
    if (!record.customer.bestDaysToContact) groups.customer.push("Which days and times work best for training sessions?");
    if (!record.customer.address || !record.customer.address.street)
      groups.customer.push("What is the best address for training?");
    (d.conflicts || []).forEach(function (c) { groups.counselor.push(questionFromConflict(c)); });
    return groups;
  }

  /* Document self-identification (Fernando's direction, 2026-11-02, after
     he swapped the SA and EAS slots by accident and got a readout full of
     "not found"): the loader takes the packet files in any order and sorts
     them itself, so nobody has to match a file to a labeled slot. The 1884
     is identified by its AcroForm sentinel fields; the SA and EAS by
     content markers that appear on those forms and not on the others
     (the SA needs BOTH markers — the generated VR2902's text contains
     "Service Authorization Number" inside "Customer Service Authorization
     Number" but never a TWC CCS line). */
  function is1884Fields(fields) {
    return !!fields &&
      Object.prototype.hasOwnProperty.call(fields, "Customers Name") &&
      Object.prototype.hasOwnProperty.call(fields, "VR Counselor Name");
  }
  function classifyText(text) {
    if (!text) return null;
    /* pdf.js text has irregular spacing ("TWC CCS  Name/Number:", triple
       spaces after colons) — normalize exactly like the parsers do before
       matching, or the real exam SA's CCS label never matches literally. */
    var t = normalizeText(text);
    if (/Service Authorization Number:/.test(t) && /TWC CCS Name\/Number:/.test(t)) return "SA";
    if (/EAS Consultation Report/.test(t) || /EAS Initial Consultation Report/.test(t)) return "EAS";
    return null;
  }
  /* A flattened/scanned 1884 (printable text, no form fields). The marker
     must be strict: an ordinary SA MENTIONS the VR1884 ("Delivery
     Instructions: Per VR1884 dated ...") and was misread as a flattened
     1884 on 2026-11-02. A real referral print carries the form's own
     printed labels — require VR1884 plus Training Topic plus Service
     Requested, none of which an SA or EAS contains. */
  function isFlat1884Text(text) {
    if (!text) return false;
    var t = normalizeText(text);
    /* The referral's printed title — present on real flattened VR1884s
       (e.g. the TWC-system print "VR1884 (08/25) Assistive Technology
       Services for Customers with Visual Impairments Referral"), absent
       from every SA and EAS checked. An earlier version required the
       words "Training Topic", which the printed form never uses — its
       topics are headed "AT Training Guide Topics" — so the real
       flattened referral fell through to "does not match". */
    return /VR1884/.test(t) && /Assistive Technology Services for Customers/.test(t);
  }

  var api = { parse1884: parse1884, parseSA: parseSA, parseEAS: parseEAS, subjectsFor: subjectsFor, buildRecord: buildRecord, counselorQuestions: counselorQuestions, is1884Fields: is1884Fields, classifyText: classifyText, isFlat1884Text: isFlat1884Text, parseFlat1884: parseFlat1884 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PacketBridgeExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
