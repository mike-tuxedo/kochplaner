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
 *
 * // Custom (z.B. Install-Dialog)
 * const result = await $id('appModal').custom({
 *     title: 'App installieren?',
 *     html: '<p>Beschreibung...</p>',
 *     confirmText: 'Installieren',
 *     cancelText: 'Später'
 * });
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

    /**
     * Show custom dialog with HTML content
     */
    custom({ title, html = '', confirmText = 'OK', cancelText = 'Abbrechen', showCancel = true, showConfirm = true, showTitle = true }) {
        const messageEl = this.querySelector('.modal-message');
        const descriptionEl = this.querySelector('.modal-description');
        const cancelBtn = this.querySelector('.modal-cancel');
        const confirmBtn = this.querySelector('.modal-confirm');

        messageEl.textContent = title;
        messageEl.style.display = showTitle ? 'inline-block' : 'none';
        
        descriptionEl.innerHTML = html;
        descriptionEl.style.display = html ? 'block' : 'none';

        cancelBtn.textContent = cancelText;
        cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
        confirmBtn.textContent = confirmText;
        confirmBtn.style.display = showConfirm ? 'inline-block' : 'none';

        this.classList.add('show');
        confirmBtn.focus();

        return new Promise((resolve) => {
            this._resolvePromise = resolve;
        });
    }

    _show(message, description, showCancel) {
        const messageEl = this.querySelector('.modal-message');
        const descriptionEl = this.querySelector('.modal-description');
        const cancelBtn = this.querySelector('.modal-cancel');
        const confirmBtn = this.querySelector('.modal-confirm');

        messageEl.textContent = message;
        messageEl.style.display = 'inline-block';

        if (description) {
            descriptionEl.textContent = description;
            descriptionEl.style.display = 'block';
        } else {
            descriptionEl.innerHTML = '';
            descriptionEl.style.display = 'none';
        }

        // Reset button texts and visibility
        cancelBtn.textContent = 'Abbrechen';
        confirmBtn.textContent = 'OK';
        cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
        confirmBtn.style.display = 'inline-block';

        this.classList.add('show');
        confirmBtn.focus();

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
