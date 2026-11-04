const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

let transporter = null;
let previewCount = 0;

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000
        });
    }
    return transporter;
}

// ---------- Look and feel (change colors here) ----------
const THEME = {
    brand: '#2563eb',
    pageBg: '#f3f4f6',
    cardBg: '#ffffff',
    panelBg: '#f9fafb',
    border: '#e5e7eb',
    text: '#111827',
    muted: '#6b7280',
    font: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
};

const TONES = {
    info: { bg: '#dbeafe', fg: '#1e40af' },
    success: { bg: '#dcfce7', fg: '#166534' },
    warning: { bg: '#fef3c7', fg: '#92400e' },
    danger: { bg: '#fee2e2', fg: '#991b1b' }
};

function appName() {
    return process.env.EMAIL_FROM_NAME || 'Dorm Item Rental';
}

function baseUrl() {
    return (process.env.APP_URL || '').trim().replace(/\/+$/, '');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Manila'
    });
}

function formatPeso(amount) {
    return '\u20B1' + Number(amount || 0).toFixed(2);
}

async function sendMail({ to, subject, text, html }) {
    return getTransporter().sendMail({
        from: `"${appName()}" <${process.env.EMAIL_USER}>`,
        replyTo: process.env.EMAIL_USER,
        to,
        subject,
        text,
        html
    });
}

// Never throws: a failed email must not break borrowing, approving, or returning.
// In preview mode (EMAIL_PREVIEW_DIR set) it saves an .html file instead of sending.
async function trySend(options) {
    const previewDir = process.env.EMAIL_PREVIEW_DIR;

    if (previewDir) {
        try {
            fs.mkdirSync(previewDir, { recursive: true });
            previewCount += 1;
            const slug = options.subject
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            const fileName = `${String(previewCount).padStart(2, '0')}-${slug}.html`;
            fs.writeFileSync(path.join(previewDir, fileName), options.html);
        } catch (err) {
            console.error('Could not save email preview:', err.message);
        }
        return;
    }

    try {
        await sendMail(options);
    } catch (err) {
        console.error(`Email to ${options.to} failed:`, err.message);
    }
}

// Builds the plain-text and HTML versions of one email
function buildEmail({
    name,
    heading,
    badge = '',
    tone = 'info',
    preheader = '',
    paragraphs = [],
    details = [],
    button = null,
    note = ''
}) {
    const app = appName();
    const t = TONES[tone] || TONES.info;

    // ----- Plain text version -----
    const textLines = [heading, '', `Hi ${name || 'there'},`, ''];
    paragraphs.forEach((p) => textLines.push(p, ''));
    if (details.length) {
        details.forEach(([label, value]) => textLines.push(`${label}: ${value}`));
        textLines.push('');
    }
    if (button) textLines.push(`${button.label}: ${button.url}`, '');
    if (note) textLines.push(note, '');
    textLines.push(`- ${app} Team`);

    // ----- HTML version -----
    const badgeHtml = badge
        ? `<span style="display: inline-block; background: ${t.bg}; color: ${t.fg}; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; padding: 6px 12px; border-radius: 999px;">${escapeHtml(badge)}</span>`
        : '';

    const paragraphsHtml = paragraphs
        .map(
            (p) =>
                `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: ${THEME.text};">${escapeHtml(p)}</p>`
        )
        .join('');

    const detailsHtml = details.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px; background: ${THEME.panelBg}; border: 1px solid ${THEME.border}; border-radius: 8px;">
            ${details
                .map(([label, value], i) => {
                    const divider = i < details.length - 1 ? `border-bottom: 1px solid ${THEME.border};` : '';
                    return `<tr>
                        <td style="padding: 12px 16px; ${divider} width: 38%; font-size: 13px; color: ${THEME.muted};">${escapeHtml(label)}</td>
                        <td style="padding: 12px 16px; ${divider} font-size: 15px; font-weight: bold; color: ${THEME.text};">${escapeHtml(value)}</td>
                    </tr>`;
                })
                .join('')}
        </table>`
        : '';

    const buttonHtml = button
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 12px;">
                <tr>
                    <td style="background: ${THEME.brand}; border-radius: 8px;">
                        <a href="${escapeHtml(button.url)}" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none;">${escapeHtml(button.label)}</a>
                    </td>
                </tr>
            </table>
            <p style="margin: 0 0 20px; font-size: 12px; line-height: 1.5; color: ${THEME.muted};">
                Button not working? Copy this link into your browser:<br>
                <span style="word-break: break-all;">${escapeHtml(button.url)}</span>
            </p>`
        : '';

    const noteHtml = note
        ? `<p style="margin: 8px 0 0; padding-top: 16px; border-top: 1px solid ${THEME.border}; font-size: 13px; line-height: 1.6; color: ${THEME.muted};">${escapeHtml(note)}</p>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(heading)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${THEME.pageBg}; font-family: ${THEME.font};">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeHtml(preheader || heading)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${THEME.pageBg};">
        <tr>
            <td align="center" style="padding: 28px 12px;">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px;">

                    <!-- Header -->
                    <tr>
                        <td style="background: ${THEME.brand}; border-radius: 12px 12px 0 0; padding: 22px 32px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="40" height="40" align="center" style="width: 40px; height: 40px; background: #ffffff; border-radius: 20px; font-size: 20px; font-weight: bold; color: ${THEME.brand};">R</td>
                                    <td style="padding-left: 12px; font-size: 18px; font-weight: bold; color: #ffffff;">${escapeHtml(app)}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="background: ${THEME.cardBg}; padding: 32px; border-left: 1px solid ${THEME.border}; border-right: 1px solid ${THEME.border};">
                            ${badgeHtml}
                            <h1 style="margin: 16px 0 20px; font-size: 24px; line-height: 1.3; color: ${THEME.text};">${escapeHtml(heading)}</h1>
                            <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: ${THEME.text};">Hi ${escapeHtml(name || 'there')},</p>
                            ${paragraphsHtml}
                            ${detailsHtml}
                            ${buttonHtml}
                            ${noteHtml}
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background: ${THEME.panelBg}; border: 1px solid ${THEME.border}; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; font-size: 12px; line-height: 1.6; color: ${THEME.muted};">
                            This email was sent by ${escapeHtml(app)}.<br>
                            If you were not expecting it, you can safely ignore it.
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return { text: textLines.join('\n'), html };
}

function linkButton(label, urlPath) {
    const base = baseUrl();
    return base ? { label, url: `${base}${urlPath}` } : null;
}

// ---------- Emails ----------

function sendPasswordResetEmail({ to, name, resetUrl }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Reset your password',
        badge: 'Security',
        tone: 'info',
        preheader: 'Use this link to choose a new password. It expires in 1 hour.',
        paragraphs: [
            `We received a request to reset your ${appName()} password. Use the button below to choose a new one. The link expires in 1 hour.`
        ],
        button: { label: 'Reset Password', url: resetUrl },
        note: 'If you did not request this, you can ignore this email and your password will stay the same.'
    });
    return trySend({ to, subject: `Reset your ${appName()} password`, text, html });
}

function sendWelcomeEmail({ to, name }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Welcome aboard',
        badge: 'Account created',
        tone: 'success',
        preheader: 'Your account is ready. You can start borrowing dorm items.',
        paragraphs: [
            `Your ${appName()} account is ready, and you can now borrow dorm items.`,
            'We will email you about your borrow requests, due dates, returns, and penalties.'
        ],
        button: linkButton('Log In', '/login')
    });
    return trySend({ to, subject: `Welcome to ${appName()}`, text, html });
}

function sendBorrowRequestEmail({ to, name, itemName, itemCode }) {
    const { text, html } = buildEmail({
        name,
        heading: 'We received your request',
        badge: 'Waiting for approval',
        tone: 'info',
        preheader: `Your request for ${itemName} is waiting for admin approval.`,
        paragraphs: [
            'Your borrow request was submitted and is waiting for admin approval. We will email you as soon as it has been reviewed.'
        ],
        details: [['Item', `${itemName} (${itemCode})`]],
        button: linkButton('View My Rentals', '/my-rentals')
    });
    return trySend({ to, subject: 'We received your borrow request', text, html });
}

function sendRentalApprovedEmail({ to, name, itemName, itemCode, dueDate }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Your request was approved',
        badge: 'Approved',
        tone: 'success',
        preheader: `${itemName} is yours until ${formatDate(dueDate)}.`,
        paragraphs: ['Good news! You can now use the item below. Please return it on or before the due date.'],
        details: [
            ['Item', `${itemName} (${itemCode})`],
            ['Due date', formatDate(dueDate)]
        ],
        button: linkButton('View My Rentals', '/my-rentals'),
        note: 'Items returned damaged may be charged a penalty, and an unpaid penalty blocks new borrowing.'
    });
    return trySend({ to, subject: 'Your borrow request was approved', text, html });
}

function sendRentalRejectedEmail({ to, name, itemName, itemCode }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Your request was not approved',
        badge: 'Not approved',
        tone: 'danger',
        preheader: `Your request for ${itemName} was not approved.`,
        paragraphs: ['Your borrow request was not approved this time. You can submit a new request at any time.'],
        details: [['Item', `${itemName} (${itemCode})`]],
        button: linkButton('Browse Items', '/borrow')
    });
    return trySend({ to, subject: 'Your borrow request was not approved', text, html });
}

function sendReturnProcessedEmail({ to, name, itemName, itemCode, condition, penaltyAmount }) {
    const conditionText = { good: 'Good', dirty: 'Dirty', damaged: 'Damaged' }[condition] || condition;
    const tone = { good: 'success', dirty: 'warning', damaged: 'danger' }[condition] || 'info';

    const paragraphs = ['Your returned item has been checked and your rental is now closed.'];
    if (condition === 'good') {
        paragraphs.push('Thank you for returning it in good condition.');
    }
    if (condition === 'dirty') {
        paragraphs.push('The item was marked as dirty and will be cleaned before it is rented out again. No penalty was added.');
    }
    if (condition === 'damaged') {
        paragraphs.push(
            penaltyAmount > 0
                ? `The item was marked as damaged and a penalty of ${formatPeso(penaltyAmount)} was added. You cannot borrow again until it is settled with the dorm officer.`
                : 'The item was marked as damaged. No penalty was added.'
        );
    }

    const details = [
        ['Item', `${itemName} (${itemCode})`],
        ['Condition', conditionText]
    ];
    if (penaltyAmount > 0) details.push(['Penalty', formatPeso(penaltyAmount)]);

    const { text, html } = buildEmail({
        name,
        heading: 'Your return was processed',
        badge: `Returned - ${conditionText}`,
        tone,
        preheader: `${itemName} was returned. Condition: ${conditionText}.`,
        paragraphs,
        details,
        button: penaltyAmount > 0 ? linkButton('View My Penalties', '/penalties') : null
    });
    return trySend({ to, subject: 'Your return has been processed', text, html });
}

function sendPenaltySettledEmail({ to, name, itemName, itemCode, amount, waived }) {
    const { text, html } = buildEmail({
        name,
        heading: waived ? 'Your penalty was waived' : 'Your penalty was paid',
        badge: waived ? 'Waived' : 'Paid',
        tone: 'success',
        preheader: 'Your penalty is settled and you can borrow items again.',
        paragraphs: [
            waived
                ? 'The admin waived your penalty. You can borrow items again.'
                : 'Your penalty was marked as paid. Thank you! You can borrow items again.'
        ],
        details: [
            ['Item', `${itemName} (${itemCode})`],
            ['Penalty', formatPeso(amount)],
            ['Status', waived ? 'Waived' : 'Paid']
        ],
        button: linkButton('Browse Items', '/borrow')
    });
    return trySend({
        to,
        subject: waived ? 'Your penalty was waived' : 'Your penalty was marked as paid',
        text,
        html
    });
}

function sendDueSoonEmail({ to, name, itemName, itemCode, dueDate }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Your rental is due soon',
        badge: 'Due within 24 hours',
        tone: 'warning',
        preheader: `Please return ${itemName} by ${formatDate(dueDate)}.`,
        paragraphs: ['This is a friendly reminder that the item below is due within 24 hours. Please return it on time.'],
        details: [
            ['Item', `${itemName} (${itemCode})`],
            ['Due date', formatDate(dueDate)]
        ],
        button: linkButton('View My Rentals', '/my-rentals')
    });
    return trySend({ to, subject: 'Reminder: your rental is due soon', text, html });
}

function sendOverdueEmail({ to, name, itemName, itemCode, dueDate }) {
    const { text, html } = buildEmail({
        name,
        heading: 'Your rental is overdue',
        badge: 'Overdue',
        tone: 'danger',
        preheader: `${itemName} was due on ${formatDate(dueDate)}. Please return it as soon as possible.`,
        paragraphs: ['The item below is now overdue. Please return it as soon as possible.'],
        details: [
            ['Item', `${itemName} (${itemCode})`],
            ['Was due on', formatDate(dueDate)]
        ],
        button: linkButton('View My Rentals', '/my-rentals')
    });
    return trySend({ to, subject: 'Your rental is overdue', text, html });
}

module.exports = {
    sendMail,
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendBorrowRequestEmail,
    sendRentalApprovedEmail,
    sendRentalRejectedEmail,
    sendReturnProcessedEmail,
    sendPenaltySettledEmail,
    sendDueSoonEmail,
    sendOverdueEmail
};