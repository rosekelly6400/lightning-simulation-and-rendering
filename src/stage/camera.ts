import { Mat4, mat4, Vec3, vec3, Vec4, vec4, Vec2, vec2 } from "wgpu-matrix";
import { toRadians } from "../utils/math_util";
import { device, canvas, fovYDegrees } from "../renderer";

class CameraUniforms {
    readonly buffer = new ArrayBuffer(72*4); // need to change the 72 if we add more variables
    private readonly floatView = new Float32Array(this.buffer);

    set viewProjMat(mat: Float32Array) {
        this.floatView.set(mat, 0);
    }

    set viewMat(mat: Float32Array) {
        this.floatView.set(mat, 16);
    }
    set invProjMat(mat: Float32Array) {
        this.floatView.set(mat, 32);
    }
    set nClip(val: number) {
        this.floatView[48] = val;
    }
    set fClip(val: number) {
        this.floatView[49] = val;
    }
    set screenX(val: number) {
        this.floatView[50] = val;
    }
    set screenY(val: number) {
        this.floatView[51] = val;
    }
    set cameraUp(vec: Float32Array) {
        this.floatView.set(vec, 52);
    }
    set cameraRight(vec: Float32Array) {
        this.floatView.set(vec, 56);
    }
    set cameraFront(vec: Float32Array) {
        this.floatView.set(vec, 60);
    }
    set cameraPos(vec: Float32Array) {
        this.floatView.set(vec, 64);
    }
    set pixelSize(vec: Float32Array) {
        this.floatView.set(vec, 68);
    }
}

export class Camera {
    uniforms: CameraUniforms = new CameraUniforms();
    uniformsBuffer: GPUBuffer;

    projMat: Mat4 = mat4.create();
    cameraPos: Vec3 = vec3.create(-7, 2, 0);
    cameraFront: Vec3 = vec3.create(0, 0, -1);
    cameraUp: Vec3 = vec3.create(0, 1, 0);
    cameraRight: Vec3 = vec3.create(1, 0, 0);
    yaw: number = 0;
    pitch: number = 0;
    moveSpeed: number = 0.004;
    sensitivity: number = 0.15;

    static readonly nearPlane = 0.1;
    static readonly farPlane = 1000;

    keys: { [key: string]: boolean } = {};

    constructor () {
        this.uniformsBuffer = device.createBuffer({
            label: "uniforms",
            size: this.uniforms.buffer.byteLength, 
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.rotateCamera(0, 0); // set initial camera vectors

        window.addEventListener('keydown', (event) => this.onKeyEvent(event, true));
        window.addEventListener('keyup', (event) => this.onKeyEvent(event, false));
        window.onblur = () => this.keys = {}; // reset keys on page exit so they don't get stuck (e.g. on alt + tab)

        canvas.addEventListener('mousedown', () => canvas.requestPointerLock());
        canvas.addEventListener('mouseup', () => document.exitPointerLock());
        canvas.addEventListener('mousemove', (event) => this.onMouseMove(event));
    }

    private onKeyEvent(event: KeyboardEvent, down: boolean) {
        this.keys[event.key.toLowerCase()] = down;
        if (this.keys['alt']) { // prevent issues from alt shortcuts
            event.preventDefault();
        }
    }

    private rotateCamera(dx: number, dy: number) {
        this.yaw += dx;
        this.pitch -= dy;

        if (this.pitch > 89) {
            this.pitch = 89;
        }
        if (this.pitch < -89) {
            this.pitch = -89;
        }

        const front = mat4.create();
        front[0] = Math.cos(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));
        front[1] = Math.sin(toRadians(this.pitch));
        front[2] = Math.sin(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));

        this.cameraFront = vec3.normalize(front);
        this.cameraRight = vec3.normalize(vec3.cross(this.cameraFront, [0, 1, 0]));
        this.cameraUp = vec3.normalize(vec3.cross(this.cameraRight, this.cameraFront));
    }

    private onMouseMove(event: MouseEvent) {
        if (document.pointerLockElement === canvas) {
            this.rotateCamera(event.movementX * this.sensitivity, event.movementY * this.sensitivity);
        }
    }

    private processInput(deltaTime: number) {
        let moveDir = vec3.create(0, 0, 0);
        if (this.keys['w']) {
            moveDir = vec3.add(moveDir, this.cameraFront);
        }
        if (this.keys['s']) {
            moveDir = vec3.sub(moveDir, this.cameraFront);
        }
        if (this.keys['a']) {
            moveDir = vec3.sub(moveDir, this.cameraRight);
        }
        if (this.keys['d']) {
            moveDir = vec3.add(moveDir, this.cameraRight);
        }
        if (this.keys['q']) {
            moveDir = vec3.sub(moveDir, this.cameraUp);
        }
        if (this.keys['e']) {
            moveDir = vec3.add(moveDir, this.cameraUp);
        }

        let moveSpeed = this.moveSpeed * deltaTime;
        const moveSpeedMultiplier = 3;
        if (this.keys['shift']) {
            moveSpeed *= moveSpeedMultiplier;
        }
        if (this.keys['alt']) {
            moveSpeed /= moveSpeedMultiplier;
        }

        if (vec3.length(moveDir) > 0) {
            const moveAmount = vec3.scale(vec3.normalize(moveDir), moveSpeed);
            this.cameraPos = vec3.add(this.cameraPos, moveAmount);
        }
    }

    onFrame(deltaTime: number) {
        this.processInput(deltaTime);

        const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
        this.projMat = mat4.perspective(toRadians(fovYDegrees), aspect, Camera.nearPlane, Camera.farPlane);

        const lookPos = vec3.add(this.cameraPos, vec3.scale(this.cameraFront, 1));
        const viewMat = mat4.lookAt(this.cameraPos, lookPos, [0, 1, 0]);
        const viewProjMat = mat4.mul(this.projMat, viewMat);

        const yscaled = Math.tan(fovYDegrees * (Math.PI / 180));
        const xscaled = (yscaled * canvas.width) / canvas.height;
        const fovx = (Math.atan(xscaled) * 180) / Math.PI;
        let fov = vec2.create(fovx, fovYDegrees);
        const pixelLength = vec2.create(2 * xscaled / canvas.width,
            2 * yscaled / canvas.height);

        this.uniforms.viewProjMat = viewProjMat;
        this.uniforms.viewMat = viewMat;
        this.uniforms.invProjMat = mat4.inverse(this.projMat);
        this.uniforms.fClip = Camera.farPlane;
        this.uniforms.nClip = Camera.nearPlane;
        this.uniforms.screenX = canvas.width;
        this.uniforms.screenY = canvas.height;
        this.uniforms.cameraUp = this.cameraUp;
        this.uniforms.cameraRight = this.cameraRight;
        this.uniforms.cameraFront = this.cameraFront;
        this.uniforms.cameraPos = this.cameraPos;
        this.uniforms.pixelSize = pixelLength;
        
        device.queue.writeBuffer(this.uniformsBuffer, 0, this.uniforms.buffer);
    }
}
