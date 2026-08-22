/**
 * Legal content (English) for NestorCut.
 *
 * Used by pages/terms-and-conditions.vue, pages/privacy.vue, pages/refund.vue.
 * The French counterpart lives in data/legal.fr.js — switching the active
 * locale (phase 2) is just a matter of importing the other file.
 *
 * NOTE — These texts are general-purpose templates written for a self-hosted
 * SaaS. They are NOT a substitute for advice from a qualified lawyer familiar
 * with the operator's jurisdiction. The operator remains responsible for
 * having them reviewed before going live commercially.
 */
import { useSiteConfig } from '~~/data/siteConfig'

const TODAY = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
})

export function useLegalNotice() {
    const { supportEmail, legal } = useSiteConfig()
    return {
        title: 'Legal Notice',
        subtitle: 'Information required under French law (article 6 of the LCEN).',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Publisher of the Service',
                paragraphs: [
                    `The NestorCut website and application ("NestorCut by ${legal.tradeName}") are published by:`,
                ],
                list: [
                    `${legal.entityName} — trade name: ${legal.tradeName}`,
                    `SIREN: ${legal.siren}`,
                    `Address: ${legal.address}`,
                    `Phone: ${legal.phone}`,
                    legal.vatNote,
                    `Contact: ${supportEmail}`,
                ],
            },
            {
                heading: '2. Publication director',
                paragraphs: [
                    `The publication director is the legal representative of ${legal.entityName}.`,
                ],
            },
            {
                heading: '3. Hosting',
                paragraphs: [
                    'The marketing website (nestorcut.com) is hosted by Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA.',
                    `The application (app.nestorcut.com), its database and the files you upload are hosted on infrastructure operated by ${legal.entityName} (${legal.tradeName}), located in France.`,
                ],
            },
            {
                heading: '4. Intellectual property',
                paragraphs: [
                    `The NestorCut name, logo and visual identity are the property of ${legal.entityName} (${legal.tradeName}). The structure and content of this website may not be reproduced without prior written authorisation.`,
                    'The source code of the application is distributed under the MIT Licence and remains governed by it.',
                ],
            },
            {
                heading: '5. Liability',
                paragraphs: [
                    'The publisher strives to provide accurate and up-to-date information but cannot be held liable for errors, omissions or service interruptions, nor for the content of third-party websites linked from this one.',
                ],
            },
        ],
        contact: {
            intro: 'Any legal question? Write to',
            email: supportEmail,
            outro: '.',
        },
    }
}

export function useTerms() {
    const { supportEmail, githubRepo, legal } = useSiteConfig()
    return {
        title: 'Terms and Conditions',
        subtitle: 'The rules that govern your use of NestorCut.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Acceptance of the terms',
                paragraphs: [
                    `These Terms and Conditions ("Terms") govern your access to and use of the NestorCut website and its nesting service (the "Service"), published by ${legal.entityName} — trade name "${legal.tradeName}", SIREN ${legal.siren} ("we", "us", or "our").`,
                    'By creating an account or using the Service in any way, you confirm that you have read, understood and accepted these Terms. If you do not agree with any part of them, you must not use the Service.',
                    'You must be at least 16 years old, or the age of digital consent in your country, to create an account. By using the Service you represent that you meet this requirement.',
                ],
            },
            {
                heading: '2. Description of the Service',
                paragraphs: [
                    'NestorCut is an online tool that arranges 2D cutting parts (DXF files) onto material sheets in order to minimise offcuts. It is intended for laser, plasma, plotter and CNC cutting professionals and hobbyists.',
                    'The Service runs optimisation heuristics. The layouts it produces are efficient but, like any nesting solver, are not mathematically guaranteed to be optimal. You remain solely responsible for verifying any layout before cutting material.',
                ],
            },
            {
                heading: '3. Account and credentials',
                paragraphs: [
                    'You are responsible for keeping your password and your session confidential and for all activity carried out from your account. Notify us without delay of any unauthorised use.',
                    'When the optional zero-knowledge encryption vault is enabled (available on every plan), a key file is generated client-side and is the only way to read your encrypted files. We never store a copy of it. If you lose it, your encrypted files become permanently unreadable and no one — including us — can recover them.',
                ],
            },
            {
                heading: '4. Plans, billing and credits',
                paragraphs: [
                    'The Service offers a free tier, a monthly subscription ("Unlimited") and a higher tier ("Pro"). Prices and included quotas are described on the pricing page and may be updated; changes take effect for future billing periods only.',
                    'Payments are processed by our payment provider, Stripe. We never receive or store your full card details. Subscriptions start with a free trial period during which you are not charged; after the trial, billing is recurring until cancellation.',
                    `Prices are displayed in euros. ${legal.vatNote}.`,
                    'Credit packs, where offered, are consumed by each nesting operation. Unless required by law, credits and subscriptions are non-refundable except under the conditions set out in our Refund Policy.',
                    'You can cancel a subscription at any time from your account. Cancellation takes effect at the end of the current billing period.',
                ],
            },
            {
                heading: '5. Your files and content',
                paragraphs: [
                    'You retain all intellectual property rights in the files you upload. We only process them to run the nesting and store the results so that you can download them.',
                    'You warrant that you hold the rights to the files you upload and that processing them does not infringe the rights of any third party.',
                    'See our Privacy Policy for how files are stored, retained and optionally encrypted with the zero-knowledge vault (available on every plan).',
                ],
            },
            {
                heading: '6. Acceptable use',
                paragraphs: [
                    'You agree not to:',
                ],
                list: [
                    'Use the Service for any unlawful, fraudulent or harmful purpose;',
                    'Attempt to access another user\'s files, account or data without authorisation;',
                    'Disrupt, overload or reverse-engineer the Service or its infrastructure;',
                    'Upload content that contains malware or is designed to exploit a vulnerability.',
                ],
            },
            {
                heading: '7. Open-source licence of the source code',
                paragraphs: [
                    'The source code of NestorCut is distributed under the MIT Licence. These Terms govern the use of the hosted Service; the use, modification and redistribution of the source code remain governed by the MIT Licence, which is available on the project repository.',
                ],
            },
            {
                heading: '8. Limitation of liability',
                paragraphs: [
                    'The Service is provided on an "as is" and "as available" basis. To the maximum extent permitted by law, we decline all liability for any direct, indirect, incidental or consequential damage arising from the use of, or inability to use, the Service.',
                    'Nesting is a heuristic process: we do not guarantee optimal results, nor the absence of errors in the generated layouts.',
                    'Security of the platform is reviewed on a regular basis. However, given the inherent complexity of software and the reliance on third-party tools and libraries, we cannot be held responsible for vulnerabilities that remain undiscovered in those third-party components.',
                    'We do not warrant that the Service will be uninterrupted or error-free, or that the results obtained will meet your specific needs.',
                ],
            },
            {
                heading: '9. Suspension and termination',
                paragraphs: [
                    'We may suspend or terminate access to the Service, without prior notice, in case of a breach of these Terms, of applicable law, or to protect the integrity of the Service.',
                    'On termination, your right to use the Service ends. Stored files may be deleted after a reasonable period, except where retention is required by law.',
                ],
            },
            {
                heading: '10. Changes to the Terms',
                paragraphs: [
                    'We may update these Terms to reflect changes in the Service or in the applicable regulations. Material changes will be notified by email or by a notice on the Service. Continued use after the changes take effect constitutes acceptance of the revised Terms.',
                ],
            },
            {
                heading: '11. Applicable law and jurisdiction',
                paragraphs: [
                    'These Terms are governed by French law. Any dispute that cannot be resolved amicably will be submitted to the competent French courts of the jurisdiction where the publisher is established.',
                    'If you are a consumer residing in the European Union, nothing in these Terms deprives you of the mandatory protections granted by the law of your country of residence.',
                ],
            },
        ],
        contact: {
            intro: 'For any question about these Terms, contact us at',
            email: supportEmail,
            outro: `or open an issue on the ${githubRepo.includes('github.com') ? 'GitHub repository' : 'project repository'}.`,
        },
    }
}

export function usePrivacy() {
    const { supportEmail, legal } = useSiteConfig()
    return {
        title: 'Privacy Policy',
        subtitle: 'How NestorCut collects, uses and protects your data.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Controller',
                paragraphs: [
                    `The controller of your personal data is ${legal.entityName} — trade name "${legal.tradeName}", SIREN ${legal.siren}, publisher of NestorCut ("NestorCut by ${legal.tradeName}"). You can contact us at ${supportEmail}.`,
                    'Your data is hosted and processed in France.',
                ],
            },
            {
                heading: '2. Data we collect',
                paragraphs: [
                    'We only collect the data strictly necessary to provide the Service:',
                ],
                list: [
                    'Account data: email address (used as the identifier), display name, hashed password.',
                    'Uploaded content: the DXF files you submit and the nesting results we generate for you.',
                    'Technical data: IP address, browser type, usage events (page views, clicks) collected via our internal tracking, for service operation and improvement.',
                    'Billing data: handled by Stripe. We only keep a reference to your Stripe customer and your subscription status — never your card details.',
                ],
            },
            {
                heading: '3. Purposes and legal basis',
                paragraphs: [
                    'Your data is processed for the following purposes:',
                ],
                list: [
                    'Providing the nesting Service (performance of the contract);',
                    'Account management and authentication (legitimate interest);',
                    'Billing and subscription management (performance of the contract);',
                    'Security, fraud prevention and abuse mitigation (legitimate interest);',
                    'Service improvement and statistics, anonymised wherever possible (legitimate interest).',
                ],
            },
            {
                heading: '4. File storage and encryption',
                paragraphs: [
                    'Your uploaded files and nesting results are stored in our database and are only accessible from your account.',
                    'A zero-knowledge encryption vault is available as an opt-in on every plan. When enabled, your files are encrypted with a key generated on your device, which is never transmitted to us in clear text. In this mode we are technically unable to read your files, even in the event of a database compromise.',
                ],
            },
            {
                heading: '5. Data retention',
                paragraphs: [
                    'Account data and files are kept for as long as your account is active. After deletion, the data is purged within a reasonable period, except where retention is required by law.',
                    'Technical logs are kept for a limited period consistent with security needs, then automatically deleted.',
                ],
            },
            {
                heading: '6. Sub-processors',
                paragraphs: [
                    'We rely on the following trusted third parties, each acting as a sub-processor:',
                ],
                list: [
                    'Stripe — payment processing (PCI-DSS certified);',
                    'Google — optional sign-in via Google account, and audience measurement on the marketing website (Google Analytics 4, IP anonymised, advertising features disabled);',
                    'Resend — transactional email delivery;',
                    'Cloudflare — hosting and content delivery of the marketing website (nestorcut.com).',
                ],
            },
            {
                heading: '7. Cookies and trackers',
                paragraphs: [
                    'NestorCut only uses cookies that are strictly necessary for the Service, plus an exempted audience-measurement tool. No advertising or cross-site tracking cookies are used, which is why no consent banner is displayed:',
                ],
                list: [
                    'sessionId — authentication session (strictly necessary, app);',
                    'oauth_code_verifier — Google sign-in security, expires after 10 minutes (strictly necessary, app);',
                    'theme and locale — interface preferences (functional, exempt from consent, app);',
                    'nest2d_session_id — anonymous first-party usage statistics (exempt audience measurement, app);',
                    '_ga — Google Analytics 4 on nestorcut.com only, configured per the French CNIL exemption: IP anonymised, no advertising signals, no cross-site tracking, 2-month data retention (website).',
                    'You can delete or block these cookies at any time in your browser settings. Blocking strictly necessary cookies will prevent sign-in.',
                ],
            },
            {
                heading: '8. Security',
                paragraphs: [
                    'We implement reasonable technical and organisational measures to protect your data: hashing of passwords, transport encryption (TLS), per-user access controls on files, and an optional zero-knowledge encryption layer.',
                    'The security of the platform is reviewed on a regular basis. However, software security can never be guaranteed absolutely, and our Service relies on third-party tools and libraries. We cannot be held responsible for vulnerabilities that remain undiscovered in those third-party components.',
                ],
            },
            {
                heading: '9. Your rights',
                paragraphs: [
                    'Depending on your jurisdiction (notably under the GDPR if you reside in the European Union), you have the following rights regarding your personal data:',
                ],
                list: [
                    'Right of access to your data;',
                    'Right to rectification;',
                    'Right to erasure ("right to be forgotten");',
                    'Right to restrict or object to processing;',
                    'Right to data portability;',
                    'Right to withdraw consent at any time, without affecting the lawfulness of prior processing.',
                ],
            },
            {
                heading: '10. Exercising your rights',
                paragraphs: [
                    'You can delete your account and all associated data at any time, self-service, from your Profile page ("Account" section). Deletion is immediate and irreversible; any active subscription is then canceled immediately, without a refund.',
                    `To exercise any of these rights, contact us at ${supportEmail}. We will respond within the legal timeframe (one month under the GDPR).`,
                    'If you reside in France, you also have the right to lodge a complaint with the CNIL (Commission Nationale de l\'Informatique et des Libertés — www.cnil.fr).',
                ],
            },
        ],
        contact: {
            intro: 'Privacy questions? Write to',
            email: supportEmail,
            outro: '.',
        },
    }
}

export function useRefund() {
    const { supportEmail } = useSiteConfig()
    return {
        title: 'Refund Policy',
        subtitle: 'Our commitment to fair, no-hassle refunds.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. 30-day money-back guarantee',
                paragraphs: [
                    'Customer satisfaction is our priority. If you are not satisfied with a paid subscription, you can request a full refund within 30 days of the charge, no questions asked.',
                    'This guarantee applies to the first billing period of a subscription. Renewals are refundable only in exceptional circumstances (for example, a service interruption on our side).',
                    'If you are a consumer residing in the European Union, you also benefit from the statutory 14-day right of withdrawal from the date of purchase, in accordance with French consumer law. By starting to use the Service immediately, you acknowledge that this right may be limited for digital content supplied with your express agreement.',
                ],
            },
            {
                heading: '2. Credits and one-off purchases',
                paragraphs: [
                    'Credit packs are consumed as you use the Service. Unused credits are not refundable, except within the 14 days following the purchase provided they have not been used and the right of withdrawal is exercised.',
                ],
            },
            {
                heading: '3. Free trial',
                paragraphs: [
                    'The free trial lets you evaluate the Service without being charged. If you cancel before the trial ends, you will not be billed at all. No refund is necessary in this case, since no payment has been taken.',
                ],
            },
            {
                heading: '4. How to request a refund',
                paragraphs: [
                    `Send your request to ${supportEmail}, indicating your account (email address) and, where applicable, the invoice concerned.`,
                    'We will process your request as soon as possible and in any case within 14 days of receipt. The refund will be made via the original payment method.',
                ],
            },
            {
                heading: '5. Account closure',
                paragraphs: [
                    'Requesting a refund does not automatically close your account. You can delete your account and the associated data at any time from your Profile page ("Account" section), as described in our Privacy Policy.',
                ],
            },
        ],
        contact: {
            intro: 'Any question about a refund? Contact',
            email: supportEmail,
            outro: '.',
        },
    }
}
