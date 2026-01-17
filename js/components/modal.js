/**
 * Modal Web Component
 * Ersetzt native alert() und confirm() Dialoge
 *
 * Usage:
 * <app-modal id="appModal"></app-modal>
 *
 * // Alert
 * await $id('appModal').alert('Nachricht');
 *
 * // Confirm
 * const result = await $id('appModal').confirm('Frage?', 'Zusätzliche Info');
 */
class ModalComponent extends HTMLElement {
    constructor() {
        super();
        this._resolvePromise = null;
    }

    connectedCallback() {
        this.render();
        this.attachEvents();
    }

    render() {
        this.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content">
                <div class="modal-body">
                    <p class="modal-message"></p>
                    <p class="modal-description"></p>
                </div>
                <div class="modal-actions">
                    <button class="modal-cancel secondary">Abbrechen</button>
                    <button class="modal-confirm">OK</button>
                </div>
            </div>
        `;
    }

    attachEvents() {
        this.querySelector('.modal-backdrop').addEventListener('click', () => this._resolve(false));
        this.querySelector('.modal-cancel').addEventListener('click', () => this._resolve(false));
        this.querySelector('.modal-confirm').addEventListener('click', () => this._resolve(true));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.classList.contains('show')) {
                this._resolve(false);
            }
            if (e.key === 'Enter' && this.classList.contains('show')) {
                this._resolve(true);
            }
        });
    }

    /**
     * Show alert dialog (only OK button)
     */
    alert(message, description = null) {
        return this._show(message, description, false);
    }

    /**
     * Show confirm dialog (OK + Cancel buttons)
     */
    confirm(message, description = null) {
        return this._show(message, description, true);
    }

    _show(message, description, showCancel) {
        const messageEl = this.querySelector('.modal-message');
        const descriptionEl = this.querySelector('.modal-description');
        const cancelBtn = this.querySelector('.modal-cancel');

        messageEl.textContent = message;

        if (description) {
            descriptionEl.textContent = description;
            descriptionEl.style.display = 'block';
        } else {
            descriptionEl.style.display = 'none';
        }

        cancelBtn.style.display = showCancel ? 'inline-block' : 'none';

        this.classList.add('show');
        this.querySelector('.modal-confirm').focus();

        return new Promise((resolve) => {
            this._resolvePromise = resolve;
        });
    }

    _resolve(value) {
        this.classList.remove('show');
        if (this._resolvePromise) {
            this._resolvePromise(value);
            this._resolvePromise = null;
        }
    }
}

customElements.define('app-modal', ModalComponent);
