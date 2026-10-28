# PacketBridge

**Referral in. Report packet out. Nothing leaves your computer.**

PacketBridge reads a Texas Workforce Commission (TWC) assistive-technology referral packet — VR1884 Referral + Service Authorization (SA) + EAS Consultation Report, all PDFs — and shows a plain-language readout: what was found, what training is being requested, any conflicts between the documents, and what is still missing.

**Live app:** https://nandomango702.github.io/packetbridge/

## Privacy model — read this first

- The web page delivers only the *program*. All processing happens **in your browser, on your machine**, using JavaScript. There is no server, no backend, no account, and no analytics.
- Packet PDFs you select are read in memory by the page. They are **never uploaded** — this site is static hosting (GitHub Pages) with no component capable of receiving files. You can verify: load the page, turn off Wi-Fi, and it still works. The code is public here for anyone to inspect.
- After the first visit, a service worker caches the *program* so it works offline and can be installed like an app ("Install PacketBridge" in Chrome/Edge). Packet data is never cached or stored by the worker.
- Prefer zero network involvement? Download the single-file build (one `.html` file) from the project releases/maintainer and open it locally — same code, no hosting at all.

## Status

v0.1 — extraction + readout. It reads PDF packets (fillable VR1884 required; SA and EAS recommended) and renders the readout. Coming next: the report-details form (provider profile, sessions, assessment subjects/ratings) and one-click generation of the VR2868 and both VR2902s (Baseline + Post-Training).

Not yet supported: Word (.docx) packets, scanned/paper packets (no OCR), flattened (non-fillable) 1884s.

Forms verified against the TWC website on 2026-10-28: VR2868 rev 08/2025, VR2902 rev 06/2022, VR1884 rev 08/2025.

## Handling real packets

Use fictional/training packets unless your instructor or agency has approved the tool. Generated/filled forms are normal PDFs — handle them with the same care (and encrypted email) as any TWC paperwork.

## How it works

Rule-based extraction only — no AI, no machine learning. The VR1884 is a fillable PDF, so its fields are read directly; the SA and EAS are print-style PDFs, so labeled values are pulled from their text. Cross-source conflicts (for example, different hardware listed on the 1884 vs. the EAS) are flagged for a human, never silently resolved.
