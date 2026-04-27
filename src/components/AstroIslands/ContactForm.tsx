// library import
import React, { useState, useEffect, useRef } from 'react';

// style import 
import './styles/ContactForm.scss';

declare global {
    interface Window {
        turnstile?: any;
    }
}

const ContactForm = () => {
    const [status, updateStatus] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [turnstileReady, setTurnstileReady] = useState(false);
    const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);
    const [startedAt] = useState(() => Date.now().toString());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const turnstileHostRef = useRef<HTMLDivElement | null>(null);
    const turnstileTokenRef = useRef('');
    const siteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '';

    useEffect(() => {
        const isDisabled = !name || !email || !message || isSubmitted;
        const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitButton) {
            submitButton.disabled = isDisabled;
            if (isSubmitting) {
                submitButton.innerText = 'Submitting...';
            }
        }
    }, [name, email, message, isSubmitting, isSubmitted]);

    useEffect(() => {
        if (status === 'SUCCESS') {
            window.location.href = '/contact-success';
        }
    }, [status]);

    useEffect(() => {
        if (!siteKey) return;
        if (!turnstileHostRef.current) return;

        const poll = setInterval(() => {
            if (!window.turnstile || turnstileWidgetId) return;
            clearInterval(poll);
            const id = window.turnstile.render(turnstileHostRef.current, {
                sitekey: siteKey,
                size: 'invisible',
                callback: (token: string) => {
                    turnstileTokenRef.current = token;
                    setTurnstileReady(true);
                },
                'expired-callback': () => {
                    turnstileTokenRef.current = '';
                    setTurnstileReady(false);
                },
                'error-callback': () => {
                    turnstileTokenRef.current = '';
                    setTurnstileReady(false);
                    setSubmitError('Security check failed. Please retry.');
                },
            });
            setTurnstileWidgetId(id);
        }, 120);

        return () => clearInterval(poll);
    }, [siteKey, turnstileWidgetId]);

    const submitForm = async (event: any) => {
        event.preventDefault();
        const form = event.target;

        setSubmitError('');
        const data = new FormData(form);
        data.set('FormStartedAt', startedAt);

        if (siteKey) {
            if (!turnstileWidgetId || !window.turnstile) {
                setSubmitError('Security check is not ready yet. Please try again.');
                return;
            }

            turnstileTokenRef.current = '';
            window.turnstile.execute(turnstileWidgetId);

            const token = await new Promise<string>((resolve) => {
                let waited = 0;
                const timer = setInterval(() => {
                    if (turnstileTokenRef.current) {
                        clearInterval(timer);
                        resolve(turnstileTokenRef.current);
                        return;
                    }
                    waited += 150;
                    if (waited >= 10000) {
                        clearInterval(timer);
                        resolve('');
                    }
                }, 150);
            });

            if (!token) {
                setSubmitError('Security verification failed. Please try again.');
                return;
            }
            data.set('cf-turnstile-response', token);
        }

        setIsSubmitting(true);
        setIsSubmitted(true);
        try {
            const res = await fetch('/contact.php', {
                method: 'POST',
                body: data,
            });
            const result = await res.json();
            if (result.result === 'success') {
                updateStatus('SUCCESS');
            }
            else {
                setSubmitError(result.message || 'Unable to submit your message right now.');
                window.location.href = "/contact-error";
            }
        }
        catch (error) {
            console.error('Form submission error:', error);
            setSubmitError('Submission failed. Please try again.');
            window.location.href = "/contact-error";
        } finally {
            if (siteKey && turnstileWidgetId && window.turnstile) {
                window.turnstile.reset(turnstileWidgetId);
                turnstileTokenRef.current = '';
                setTurnstileReady(false);
            }
        }
    }

    return (
        <form
            className='ContactForm'
            onSubmit={submitForm}
            method={'POST'}>
            <label htmlFor="contactName">Name:</label>
            <input
                title='Name'
                type='text'
                name='Name'
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
                autoComplete="on"
                id="contactName"
            />
            <label htmlFor="contactNumber">Phone No:</label>
            <input
                title='Phone'
                type='number'
                name='Phone'
                autoComplete="on"
                id="contactNumber"
            />
            <label htmlFor="contactEmail">Email:</label>
            <input
                title='Email'
                type='email'
                name='Email'
                value={email}
                required
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="on"
                id="contactEmail"
            />
            <label className='message' htmlFor="contactMessage">Message:</label>
            <h4>Hello Aritra,</h4>
            <textarea
                title='Message'
                name='Message'
                value={message}
                required
                onChange={(event) => setMessage(event.target.value)}
                id="contactMessage"
            >
            </textarea>
            <input
                type="text"
                name="Website"
                tabIndex={-1}
                autoComplete="off"
                className="honeypotField"
                aria-hidden="true"
            />
            <input type="hidden" name="FormStartedAt" value={startedAt} />
            <div ref={turnstileHostRef} className="turnstileHidden"></div>
            {submitError ? <p id="error_msg">{submitError}</p> : null}
            {status === 'SUCCESS' ? (
                <div className="success-message">Message sent successfully! Redirecting...</div>
            ) : (
                <button id="subBtn" type='submit' disabled={isSubmitting || isSubmitted}>
                    {isSubmitting ? 'Submitting...' : 'Send Message'}
                </button>
            )}
        </form>
    );
};

export default ContactForm;
