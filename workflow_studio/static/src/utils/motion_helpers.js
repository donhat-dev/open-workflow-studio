/** @odoo-module **/

/**
 * Motion.dev Helper Utilities for Workflow Pilot
 * 
 * Provides animation functions for UX enhancements.
 * Uses window.Motion which is loaded from CDN.
 * 
 * @core - Pure utility, works with or without Odoo
 */

export const MotionHelpers = {
    /**
     * Check if Motion library is available
     */
    isAvailable() {
        return typeof window !== 'undefined' && window.Motion?.animate;
    },

    /**
     * Animate node entrance (drop/create)
     * Uses CSS transform for smoother performance
     * @param {HTMLElement} element 
     */
    animateNodeIn(element) {
        if (!this.isAvailable() || !element) return;

        // Use transform instead of scale for better performance
        window.Motion.animate(element,
            {
                transform: ['scale(0.9)', 'scale(1)'],
                opacity: [0, 1]
            },
            {
                duration: 0.18,
                easing: 'ease-out'
            }
        );
    },

    /**
     * Animate node exit (delete)
     * @param {HTMLElement} element 
     * @param {Function} onComplete - callback after animation
     * @returns {Promise}
     */
    animateNodeOut(element, onComplete) {
        if (!this.isAvailable() || !element) {
            onComplete?.();
            return Promise.resolve();
        }

        const animation = window.Motion.animate(element,
            {
                transform: ['scale(1)', 'scale(0.9)'],
                opacity: [1, 0]
            },
            {
                duration: 0.12,
                easing: 'ease-in'
            }
        );

        return animation.finished.then(() => {
            onComplete?.();
        });
    },

    /**
     * Animate node to new position (for tidy up)
     * Uses CSS transform for GPU acceleration
     * @param {HTMLElement} element 
     * @param {number} x 
     * @param {number} y 
     * @param {Object} options
     */
    animateNodePosition(element, x, y, options = {}) {
        if (!element) return Promise.resolve();

        if (!this.isAvailable()) {
            element.style.left = `${x}px`;
            element.style.top = `${y}px`;
            return Promise.resolve();
        }

        const delay = options.delay || 0;
        const duration = options.duration || 0.35;

        const animation = window.Motion.animate(element,
            {
                left: `${x}px`,
                top: `${y}px`
            },
            {
                duration,
                delay,
                easing: [0.25, 0.1, 0.25, 1] // ease-out cubic
            }
        );

        return animation.finished;
    },

    /**
     * Animate connection path (stroke draw-in effect)
     * @param {SVGPathElement} pathElement 
     */
    animateConnectionIn(pathElement) {
        if (!this.isAvailable() || !pathElement) return;

        try {
            const length = pathElement.getTotalLength();
            if (!length || !isFinite(length)) return;

            pathElement.style.strokeDasharray = `${length}`;
            pathElement.style.strokeDashoffset = `${length}`;

            const animation = window.Motion.animate(pathElement,
                { strokeDashoffset: [length, 0] },
                {
                    duration: 0.25,
                    easing: 'ease-out'
                }
            );

            animation.finished.then(() => {
                // Reset to normal after animation
                pathElement.style.strokeDasharray = '';
                pathElement.style.strokeDashoffset = '';
            });
        } catch (e) {
            // SVG path might not support getTotalLength
            console.debug('[MotionHelpers] Connection animation skipped:', e.message);
        }
    },

    /**
     * Stagger helper for multiple elements
     * @param {number} delayPerItem 
     * @returns {Function}
     */
    stagger(delayPerItem = 0.02) {
        if (!this.isAvailable()) return () => 0;
        return window.Motion.stagger?.(delayPerItem) || ((i) => i * delayPerItem);
    },

    /**
     * Animate dropdown entrance (from toolbar + Node)
     * @param {HTMLElement} element 
     */
    animateDropdownIn(element) {
        if (!this.isAvailable() || !element) return;

        // window.Motion.animate(element,
        //     {
        //         transform: ['translateY(-8px) scale(0.98)', 'translateY(0) scale(1)'],
        //         opacity: [0, 1],
        //     },
        //     {
        //         duration: 0.2,
        //         easing: [0.0, 0.0, 0.2, 1] // ease-out (material design)
        //     }
        // );
    },

    /**
     * Animate dropdown exit
     * @param {HTMLElement} element 
     * @param {Function} onComplete
     * @returns {Promise}
     */
    animateDropdownOut(element, onComplete) {
        if (!this.isAvailable() || !element) {
            onComplete?.();
            return Promise.resolve();
        }

        const animation = window.Motion.animate(element,
            {
                transform: ['translateY(0) scale(1)', 'translateY(-4px) scale(0.98)'],
                opacity: [1, 0],
            },
            {
                duration: 0.15,
                easing: [0.4, 0.0, 1, 1] // ease-in
            }
        );

        return animation.finished.then(() => {
            onComplete?.();
        });
    },

    /**
     * Simple fade in
     * @param {HTMLElement} element 
     * @param {number} duration
     */
    fadeIn(element, duration = 0.2) {
        if (!this.isAvailable() || !element) return;
        window.Motion.animate(element, { opacity: [0, 1] }, { duration, easing: 'ease-out' });
    },

    /**
     * Simple fade out
     * @param {HTMLElement} element 
     * @param {Function} onComplete
     * @returns {Promise}
     */
    fadeOut(element, onComplete, duration = 0.15) {
        if (!this.isAvailable() || !element) {
            onComplete?.();
            return Promise.resolve();
        }

        const animation = window.Motion.animate(element,
            { opacity: [1, 0] },
            { duration, easing: 'ease-in' }
        );

        return animation.finished.then(() => {
            onComplete?.();
        });
    }
};
