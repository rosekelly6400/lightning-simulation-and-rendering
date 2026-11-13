export var audioContext: AudioContext;

export async function initWebAudio() {
    audioContext = new AudioContext();
    // add master control volume?

}
export async function resumeAudio() {
    if (audioContext.state === 'suspended') await audioContext.resume();
}

async function play(buffer: AudioBuffer, volume: number = 1.0)
{
    await resumeAudio();

    const src = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = volume;

    src.buffer = buffer;
    src.connect(gain).connect(audioContext.destination);

    src.start();
}

// float32array[] -> AudioBuffer
function bufferFromSamples(
        channels: Float32Array<ArrayBuffer>[],
        sampleRate = audioContext.sampleRate
    ): AudioBuffer 
{
    // assume channels have the same length
    const buf = audioContext.createBuffer(2, channels[0].length, sampleRate); // we may use more channels for purposes of cacheing
        channels.forEach((samples, i) => buf.copyToChannel(samples, i));

    return buf;
}

// placeholder debug sound: 1s decaying 440 Hz tone, returned as 2 channels (stereo)
export function generateDefaultSound()
{
    const frames = Math.floor(audioContext.sampleRate * 1.0);
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        const t = i / audioContext.sampleRate;
        samples[i] = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-6 * t);
    }
    return [samples, samples];
}

  // read from wav file
export async function bufferFromWAV(
    url: string,
    seconds: number = 3
): Promise<Float32Array<ArrayBuffer>> 
{
    const res = await fetch(url);
if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);

const data = await res.arrayBuffer();
const magic = new TextDecoder().decode(data.slice(0, 4));
console.log(url, res.headers.get('content-type'), data.byteLength, 'bytes, starts with:', magic);

if (magic !== 'RIFF') {
    throw new Error(`${url} is not a WAV file (got "${magic}", content-type ${res.headers.get('content-type')})`);
}
const decoded = await audioContext.decodeAudioData(data);

    // const decoded = await audioContext.decodeAudioData(await res.arrayBuffer());
    const frames = seconds === undefined
        ? decoded.length
        : Math.min(decoded.length, Math.floor(seconds * decoded.sampleRate));

    const out = new Float32Array(frames);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < frames; i++) out[i] += ch[i] / decoded.numberOfChannels;
    }
    return out;
}

export class ThunderSound {
    private gainValue = 1.0; // linear gain after distance attenuation
    public channels: Float32Array<ArrayBuffer>[]; // there are 2 channels
    protected time_until_play: number; // seconds
    public dist = 1.0; // how far it is, meters
    public finished = false;

    private static SPEEDOFSOUND = 343; // m/s
    private static REFDIST = 100; // distance which sound plays at its source volume, otherwise gain falls off

    // check https://pubs.aip.org/aip/jpr/article/54/4/043101/3373738/Speed-of-sound-in-humid-air-Accurate-thermodynamic for speed of sound with humidity, delays are ~ 0.01 seconds on oom
    constructor(ch: Float32Array<ArrayBuffer>[], distance: number, volume: number) {
        this.channels = ch;
        this.dist = distance;
        this.gainValue = volume - Math.min(1, ThunderSound.REFDIST / distance);
        this.time_until_play = distance / ThunderSound.SPEEDOFSOUND;
    }
    
    public use_gpu = false;
    public getVolume()
    {
        return this.gainValue; // TODO: attenuate as we are further
    }

    frame(dt: number)
    {
        if (this.finished) return;

        this.time_until_play -= dt;
        if (this.time_until_play  <= 0.)
        {
            const buffer: AudioBuffer = bufferFromSamples(this.channels);
            play(buffer, this.gainValue);
            this.finished = true; // tells renderer to remove this object
        }
    }

}