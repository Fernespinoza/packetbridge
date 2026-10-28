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
      customerName: find(text, /Customer Name:\s*\n?\s*([A-Z][A-Za-z ]+)/),
      contractNumber: find(text, /Contract Number:\s*(\S+)/),
      vendorNumber: find(text, /Vendor Number:\s*(\S+)/),
      dateIssued: find(text, /Date Issued:\s*([\d/]+)/),
      startDate: find(text, /Start Date:\s*([\d/]+)/),
      endDate: find(text, /End Date:\s*([\d/]+)/),
      totalCost: find(text, /Total Cost:\s*\$\s*([\d,]+)/)
    };
    var m = text.match(/TWC CCS Name\/Number:\s*\n?\s*([A-Za-z ]+?)\s*\/\s*(\d+)/);
    if (m) { auth.counselorName = clean(m[1]); auth.counselorCaseload = clean(m[2]); }
    var office = {
      name: find(text, /Invoice To: Vocational Rehabilitation Services\s*\n([^\n]+)/),
      street: stripTrailingComma(find(text, /Invoice To: Vocational Rehabilitation Services\s*\n[^\n]+\n([^\n]+)/)),
      cityLine: find(text, /Invoice To: Vocational Rehabilitation Services\s*\n[^\n]+\n[^\n]+\n([^\n]+)/)
    };
    var twcContact = {
      name: find(text, /TWC Contact Name:\s*([A-Za-z ]+)/),
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
      reportFor: find(text, /EAS Consultation Report for:\s*([A-Za-z ]+)/),
      consultDate: find(text, /Consultation Date:\s*([\d/]+)/),
      caseId: find(text, /Case ID:\s*(\d+)/),
      vrc: find(text, /VR Counselor:\s*([A-Za-z ]+)/),
      easName: find(text, /EAS Initial Consultation Report Prepared by:\s*([A-Za-z ]+)/),
      goal: find(text, /Vocational \(IPE\) Goal:\s*([^\n]+)/),
      visualDisability: find(text, /Visual Disability:\s*([^\n]+)/),
      acuityOD: find(text, /Visual Acuities OD:\s*(\S+)/),
      acuityOS: find(text, /Visual Acuities OS:\s*(\S+)/),
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
      else if (t.topic === "Viewing and Creating Spreadsheets using Microsoft Excel") subjects["Spreadsheet"] = true;
      else if (t.topic.indexOf("OCR Software") === 0) subjects["Optical Character Recognition (OCR)"] = true;
      else if (t.topic === "Braille Note Takers") subjects["Notetaker"] = true;
      else if (t.topic === "Operating Feature Function and Maintenance") subjects["Microsoft Windows"] = true;
      else if (t.topic === "Computer Skills and Mobile Operating System Skills Post Training Assessments") { /* signals post 2902 */ }
      else notes.push("No 2902 subject exists for topic: " + t.label + " (objective text only)");
    });
    return { subjects: Object.keys(subjects).sort(), notes: notes };
  }

  function buildRecord(fields1884, saText, easText) {
    var record = {};
    var a = parse1884(fields1884); Object.assign(record, a);
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
      conflicts: conflicts
    };
    return record;
  }

  var api = { parse1884: parse1884, parseSA: parseSA, parseEAS: parseEAS, subjectsFor: subjectsFor, buildRecord: buildRecord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PacketBridgeExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
