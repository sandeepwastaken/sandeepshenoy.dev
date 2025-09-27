const CONFIG = {
    MIN_CIRCLE_SIZE: 500,
    MAX_CIRCLE_SIZE: 700,
    
    SPAWN_INTERVAL: 750,
    FADE_DURATION: 9000,
    MAX_CIRCLES: 15,
    
    MIN_SPEED: 0.015,
    MAX_SPEED: 0.03,
    
    TOP: '#8e4dffff',
    BOTTOM: '#571368ff',
    OPACITY_START: 0.15,
    OPACITY_PEAK: 0.3,
    
    MIN_BLUR: 0,
    MAX_BLUR: 100
};

class FloatingCircle {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = CONFIG.MIN_CIRCLE_SIZE + Math.random() * (CONFIG.MAX_CIRCLE_SIZE - CONFIG.MIN_CIRCLE_SIZE);
        this.vx = (Math.random() - 0.5) * (CONFIG.MAX_SPEED - CONFIG.MIN_SPEED) + CONFIG.MIN_SPEED;
        this.vy = (Math.random() - 0.5) * (CONFIG.MAX_SPEED - CONFIG.MIN_SPEED) + CONFIG.MIN_SPEED;
        this.opacity = 0;
        this.age = 0;
        this.maxAge = CONFIG.FADE_DURATION;
        this.fadeInDuration = CONFIG.FADE_DURATION * 0.2;
        this.fadeOutStart = CONFIG.FADE_DURATION * 0.6;
        this.blur = CONFIG.MIN_BLUR + Math.random() * (CONFIG.MAX_BLUR - CONFIG.MIN_BLUR);
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;

        if (this.x + this.size < 0) this.x = this.canvas.width + this.size;
        if (this.x - this.size > this.canvas.width) this.x = -this.size;
        if (this.y + this.size < 0) this.y = this.canvas.height + this.size;
        if (this.y - this.size > this.canvas.height) this.y = -this.size;

        this.age += deltaTime;
        
        if (this.age < this.fadeInDuration) {
            this.opacity = (this.age / this.fadeInDuration) * CONFIG.OPACITY_PEAK;
        } else if (this.age < this.fadeOutStart) {
            this.opacity = CONFIG.OPACITY_PEAK;
        } else {
            const fadeProgress = (this.age - this.fadeOutStart) / (this.maxAge - this.fadeOutStart);
            this.opacity = CONFIG.OPACITY_PEAK * (1 - fadeProgress);
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.filter = `blur(${this.blur}px)`;
        const cx = Math.round(this.x) + 0.5;
        const cy = Math.round(this.y) + 0.5;
        const r = this.size / 2;
        const blend = Math.min(1, Math.max(0, cy / this.canvas.height));
        function lerpColor(a, b, t) {
            const ar = parseInt(a.slice(1,3),16), ag = parseInt(a.slice(3,5),16), ab = parseInt(a.slice(5,7),16), aa = parseInt(a.slice(7,9),16);
            const br = parseInt(b.slice(1,3),16), bg = parseInt(b.slice(3,5),16), bb = parseInt(b.slice(5,7),16), ba = parseInt(b.slice(7,9),16);
            const rr = Math.round(ar + (br-ar)*t);
            const rg = Math.round(ag + (bg-ag)*t);
            const rb = Math.round(ab + (bb-ab)*t);
            const ra = Math.round(aa + (ba-aa)*t);
            return `rgba(${rr},${rg},${rb},${(ra/255).toFixed(2)})`;
        }
        const circleColor = lerpColor(CONFIG.TOP, CONFIG.BOTTOM, blend);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, circleColor);
        gradient.addColorStop(0.7, circleColor);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    isDead() {
        return this.age >= this.maxAge;
    }
}

class CanvasAnimation {
    constructor() {
        this.canvas = document.getElementById('backgroundCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.circles = [];
        this.lastTime = 0;
        this.lastSpawn = 0;
        
        this.setupCanvas();
        this.bindEvents();
        this.start();
    }

    setupCanvas() {
        this.resizeCanvas();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });
    }

    spawnCircle() {
        if (this.circles.length < CONFIG.MAX_CIRCLES) {
            this.circles.push(new FloatingCircle(this.canvas));
        }
    }

    update(currentTime) {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        if (currentTime - this.lastSpawn > CONFIG.SPAWN_INTERVAL) {
            this.spawnCircle();
            this.lastSpawn = currentTime;
        }
        
        this.circles.forEach(circle => circle.update(deltaTime));
        
        this.circles = this.circles.filter(circle => !circle.isDead());
    }

    draw() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        
        this.circles.forEach(circle => circle.draw(this.ctx));
    }

    animate(currentTime) {
        this.update(currentTime);
        this.draw();
        requestAnimationFrame((time) => this.animate(time));
    }

    start() {
        for (let i = 0; i < 3; i++) {
            const circle = new FloatingCircle(this.canvas);
            circle.age = Math.random() * CONFIG.FADE_DURATION * 0.5;
            this.circles.push(circle);
        }
        
        requestAnimationFrame((time) => this.animate(time));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CanvasAnimation();
});
