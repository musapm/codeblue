/**
 * English strings for voice (Phase 13): the chat controls, the privacy notice and the voice
 * settings with the provider evaluation. The Arabic module must match this shape (`VoiceDictionary`).
 */
export const voiceEn = {
  controls: {
    dictate: 'Speak your question',
    listening: 'Listening. Speak now.',
    stopListening: 'Stop listening',
    readAloud: 'Read aloud',
    stopReading: 'Stop reading',
    denied: 'Microphone access was refused. You can allow it in your browser settings.',
    failed: 'Speech did not work. Please type instead.',
  },
  notice: {
    browser:
      'Voice uses your browser’s speech features: some browsers send your voice to their maker’s servers to turn it into text. The university stores none of what you say, only how long voice was used.',
    server: 'Voice is processed by the university’s speech provider. The university stores no recordings, only how long voice was used.',
  },
  settings: {
    title: 'Voice',
    subtitle: 'Speech input and reading answers aloud in the student and staff assistant chats.',
    status: 'Status',
    on: 'On',
    off: 'Off',
    enabled: 'Turn voice on',
    input: 'Speech input (speech to text)',
    inputHint: 'Fills the message box; people still check and send their question.',
    output: 'Read answers aloud (text to speech)',
    provider: 'Speech provider',
    providers: { browser: 'Each person’s browser', server: 'The university’s speech provider' } as Record<string, string>,
    providerHints: {
      browser: 'No cost. Works in browsers with built-in speech features; some of them send audio to their maker’s servers.',
      server: 'Audio and text go to a provider the university contracts, with a monthly budget and a daily limit.',
    } as Record<string, string>,
    serverMissing:
      'No speech provider is connected in this environment, so the server option says “not available” to people. Connecting one needs a provider decision and its key (see “Choosing a provider”).',
    prices: 'Your contract prices',
    inputPrice: 'Speech input (USD per minute)',
    outputPrice: 'Read-aloud (USD per 1,000 characters)',
    priceHint: 'From your provider contract. No prices are built in: without them, the cost is shown as unknown.',
    budget: 'Monthly voice budget (USD)',
    budgetHint: 'For the server provider: when this month’s cost reaches it, voice pauses until the next month.',
    dailyMinutes: 'Speech input per person per day (minutes)',
    save: 'Save settings',
    usage: {
      title: 'This month',
      inputMinutes: 'Speech input (minutes)',
      outputCharacters: 'Characters read aloud',
      people: 'People using voice',
      cost: 'Cost',
      unpriced: (n: number) => (n === 1 ? '1 use has no price' : `${n} uses have no price`),
      note: 'Only durations and character counts are kept; no audio and no text.',
    },
    evaluation: {
      title: 'Choosing a provider',
      intro: 'Compare candidates on your own recordings before you decide. What matters most:',
      points: [
        'Arabic accuracy: Modern Standard Arabic and the dialects your students speak, with university names and terms.',
        'Where audio goes: the country it is processed in, whether it is stored, and whether it is used to train models.',
        'Speed: how long it takes to get text back, and whether results can stream.',
        'Voices: natural Arabic and English voices for reading aloud.',
        'Price: per minute of speech and per 1,000 characters read, from your contract. Enter them above to track cost.',
        'On your own servers: open-source models avoid sending audio out, but need hardware and upkeep.',
      ],
    },
  },
}

export type VoiceDictionary = typeof voiceEn
