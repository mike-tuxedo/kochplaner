/**
 * @fileoverview Slide-up drawer Web Component.
 * Provides a mobile-friendly bottom drawer with drag-to-dismiss functionality.
 * @module components/drawer
 */

/**
 * Custom drawer element that slides up from the bottom.
 * Supports both mouse and touch interactions for dragging.
 *
 * @extends HTMLElement
 * @example
 * <app-drawer id="myDrawer">
 *   <h2>Drawer Content</h2>
 *   <button close-drawer>Close</button>
 * </app-drawer>
 *
 * // Open drawer
 * document.getElementById('myDrawer').open();
 */
class DrawerComponent extends HTMLElement {
    constructor() {
        super();
        this.diffY = 0;
        this.mouseDown = false;
        this.startY = 0;
        this.clicked = null;
        this.clickedEl = null;
        this._rafId = null;
        this._isDragging = false;
    }

    connectedCallback() {
        this.render();
        this.attachEvents();
    }

    disconnectedCallback() {
        this.removeEventListener('mousedown', this.handleMouseDown);
        this.removeEventListener('mousemove', this.handleMouseMove);
        this.removeEventListener('mouseup', this.handleMouseUp);
    }

    render() {
        // Wrap existing content in drawer structure (only once)
        if (!this.querySelector('.drawer-inner')) {
            const content = this.innerHTML;
            this.innerHTML = `
                <div class="drawer-backdrop"></div>
                <div class="drawer-inner">
                    <span class="drawer-handle"></span>
                    <div class="drawer-content">${content}</div>
                </div>
            `;
        }
        this.drawerInner = this.querySelector('.drawer-inner');
        this.drawerContent = this.querySelector('.drawer-content');
        this.drawerHandle = this.querySelector('.drawer-handle');
    }

    attachEvents() {
        // Mouse events (desktop)
        this.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // Touch events only on handle (mobile)
        this.drawerHandle.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.drawerHandle.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.drawerHandle.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });

        // Close on backdrop click
        this.querySelector('.drawer-backdrop')?.addEventListener('click', () => this.close());

        // Close button support
        this.querySelectorAll('[close-drawer]').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });
    }

    handleMouseDown(event) {
        if (event.touches) return;
        this.mouseDown = true;
        this.startY = event.clientY;
        this.clicked = event.target;
    }

    handleMouseMove(event) {
        if (event.touches || !this.mouseDown) return;

        const moveY = event.clientY;
        this.diffY = moveY - this.startY;

        if (this.diffY > 0) {
            this.drawerInner.style.transform = `translateY(${this.diffY}px)`;
        }
    }

    handleMouseUp(event) {
        if (event.touches) return;
        this.mouseDown = false;

        if (this.clicked?.closest('[close-drawer]') ||
            this.clicked === this.querySelector('.drawer-backdrop') ||
            this.diffY > 150) {
            this.close();
            return;
        }

        this.resetPosition();
    }

    handleTouchStart(event) {
        this._isDragging = true;
        this.startY = event.touches[0].clientY;
    }

    handleTouchMove(event) {
        if (!this._isDragging) return;

        event.preventDefault();
        this.drawerInner.style.transition = 'none';

        if (!this._rafId) {
            this._rafId = requestAnimationFrame(() => {
                const moveY = event.touches[0].clientY;
                this.diffY = moveY - this.startY;

                if (this.diffY > 0) {
                    this.drawerInner.style.transform = `translateY(${this.diffY}px)`;
                }
                this._rafId = null;
            });
        }
    }

    handleTouchEnd() {
        this._isDragging = false;
        this.drawerInner.style.transition = '';

        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this.diffY > 150) {
            this.close();
            return;
        }

        this.resetPosition();
    }

    resetPosition() {
        this.diffY = 0;
        this.drawerInner.style.transform = '';
    }

    open() {
        $$('.page').forEach(page => page.style.overflow = 'hidden');
        $('body').setAttribute('drawer-open', 'true');
        this.classList.add('show');
        this.resetPosition();
    }

    close() {
        $$('.page').forEach(page => page.style.overflow = 'auto');
        $('body').setAttribute('drawer-open', 'false');
        this.classList.remove('show');
        this.resetPosition();
    }
}

customElements.define('app-drawer', DrawerComponent);
