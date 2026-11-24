# Voice: providers and cost

_Phase 13 · see ADR-033 for the decisions_

Voice adds two things to the student and staff assistant chats:
- **speech input:** speech to text that fills the message box (the person still checks and sends);
- **read-aloud:** text to speech for an answer.

It is off by default and switched on per university (Voice page, `assistant.configure`, feature `voice`).

## Providers

Both directions go through one interface (`SpeechProvider` on the server, `VoiceConfig` in the chat), with two kinds of provider:

| Provider | Where speech is processed | Cost to the university | State |
| --- | --- | --- | --- |
| `browser` | In each person's browser. Chrome and Edge send dictation audio to their maker's servers, Safari uses Apple's speech service or the device. Read-aloud uses the voices installed on the device | None | **Working** (where the browser supports it; the controls are hidden otherwise) |
| `server` | At a speech vendor the university contracts, through `/api/voice/[tenant]/transcribe` and `/speak` | Per minute of speech and per 1,000 characters read, from the contract | **Interface, endpoints, limits and usage tracking built and tested with a fake vendor; no vendor connected** (`getServerSpeechProvider()` returns null, the endpoints answer "not configured") |

Connecting a vendor means writing one adapter that implements `transcribe` and `synthesize`, registering it in `src/lib/voice/provider.ts`, and setting `VOICE_PROVIDER` and the vendor's key. No adapter was written yet, for two reasons:
- choosing the vendor is the product owner's decision (below);
- an adapter for an API that cannot be called from here could not be tested, and untested code would be presented as working.

## How to evaluate candidates

Use the same 30–50 recordings for every candidate: students and staff from the university, in Modern Standard Arabic and the local dialect, English, mixed sentences, with names of buildings, offices and programs, in quiet and noisy rooms.

| Criterion | What to measure |
| --- | --- |
| Arabic accuracy | Word error rate on the recordings above, separately for MSA, dialect and mixed speech. Check university-specific names |
| Read-aloud quality | Listening test of natural Arabic and English voices on real assistant answers (numbers, dates, times, abbreviations) |
| Data handling | Where audio is processed (country/region), whether it is stored and for how long, whether it is used to train models, and a data processing agreement |
| Speed | Time from the end of speaking to text; whether partial results stream |
| Price | Per minute of speech input and per 1,000 characters of speech output, from a written offer or contract |
| Operations | Rate limits, availability commitments, and support for the university's region |

Candidate groups:
1. **Each person's browser.** This is the current default and costs nothing. Accuracy and data handling depend on the browser, and the university does not control it. The chat discloses this to people.
2. **Cloud speech services** from the large cloud and AI vendors. They are paid per use and need a contract and a data processing agreement.
3. **Open-source speech models run on the university's own servers.** No audio leaves the university, but this needs GPU hardware and upkeep.

## Cost tracking

No prices are built into the product. On the Voice page, administrators enter their contract's prices:
- input: USD per minute;
- output: USD per 1,000 characters.

Every use is recorded in `voice_usage_events`, separately from the AI token usage. A row holds:
- seconds of speech input, or characters read aloud;
- the provider and the chat;
- the cost computed by the database from those prices (0 for the browser; left empty when no price was entered).

No audio and no text is stored. The Voice page and the analytics dashboard show this month's minutes, characters, people and cost. For the server provider, a monthly budget and a daily speech-input limit per person stop new requests.

## Not built
- A vendor adapter (needs the decision and a key).
- Voice in the public admissions assistant (anonymous visitors).
- Streaming speech input.
- An Arabic dialect setting per university (Arabic is `ar-SA` for now).
