import './style.css'
import { Pane } from 'tweakpane';
import { initWebGPU, Renderer } from './renderer';
import { allRenderer } from './renderers/alltogether_renderer'; // TODO: add more renderers as we see git
import { cloudRenderer } from './renderers/cloud_renderer'; 
// import { lightningRenderer } from './renderers/lightning_renderer'; 
// import { soundRenderer } from './renderers/sound_renderer'; 

import { Camera } from './stage/camera';
import { Cloud_Precomputation } from './stage/cloud_precomputation';
import { Stage } from './stage/stage';


await initWebGPU(); // in renderer.ts

const camera = new Camera();
const cloud_precomputation = new Cloud_Precomputation(camera);
const stage = new Stage(camera, cloud_precomputation);

var renderer: Renderer | undefined;

const renderModes = { all: 'all',
    cloud: 'cloud', lightning: 'lightning', sound: 'sound', 
};

function setRenderer(mode: string) {
    renderer?.stop();

    switch (mode) {
        case renderModes.cloud:
            renderer = new cloudRenderer(stage);
            break;
        // case renderModes.lightning:
        //     renderer = new LightningRenderer(stage);
        //     break;
        // case renderModes.sound:
        //     renderer = new SoundRenderer(stage);
        //     break;
        case renderModes.all:
            renderer = new allRenderer(stage);
    }
}

// Tweakpane: easily adding tweak control for parameters.
const PARAMS = {
    mode: renderModes.cloud,
    level: 0,
    name: 'Test',
    active: true,
    };

    const pane = new Pane({
    title: 'Debug',
    expanded: false,
    });

pane.addInput(PARAMS, 'mode', {options: renderModes}).on('change', (ev) => setRenderer(ev.value));

    pane.addInput(PARAMS, 'level', {min: 0, max: 100});
    pane.addInput(PARAMS, 'name');
    pane.addInput(PARAMS, 'active');

setRenderer(PARAMS.mode);