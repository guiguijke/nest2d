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

export function useTerms() {
    const { supportEmail, githubRepo } = useSiteConfig()
    return {
        title: 'Terms and Conditions',
        subtitle: 'The rules that govern your use of NestorCut.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Acceptance of the terms',
                paragraphs: [
                    'These Terms and Conditions ("Terms") govern your access to and use of the NestorCut website and its nesting service (the "Service"), operated by the project maintainer ("we", "us", or "our").',
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
                    'When the zero-knowledge encryption feature (Pro plan) is enabled, a key file is generated client-side and is the only way to read your encrypted files. We never store a copy of it. If you lose it, your encrypted files become permanently unreadable and no one — including us — can recover them.',
                ],
            },
            {
                heading: '4. Plans, billing and credits',
                paragraphs: [
                    'The Service offers a free tier, a monthly subscription ("Unlimited") and a higher tier ("Pro"). Prices and included quotas are described on the pricing page and may be updated; changes take effect for future billing periods only.',
                    'Payments are processed by our payment provider, Stripe. We never receive or store your full card details. Subscriptions start with a free trial period during which you are not charged; after the trial, billing is recurring until cancellation.',
                    'Credit packs, where offered, are consumed by each nesting operation. Unless required by law, credits and subscriptions are non-refundable except under the conditions set out in our Refund Policy.',
                    'You can cancel a subscription at any time from your account. Cancellation takes effect at the end of the current billing period.',
                ],
            },
            {
                heading: '5. Your files and content',
                paragraphs: [
                    'You retain all intellectual property rights in the files you upload. We only process them to run the nesting and store the results so that you can download them.',
                    'You warrant that you hold the rights to the files you upload and that processing them does not infringe the rights of any third party.',
                    'See our Privacy Policy for how files are stored, retained and (on the Pro plan) encrypted.',
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
                heading: '11. Applicable law',
                paragraphs: [
                    'These Terms are governed by the law of the country in which the Service operator is established, to the exclusion of conflict-of-law rules. Any dispute that cannot be resolved amicably will be submitted to the competent courts of that jurisdiction.',
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
    const { supportEmail } = useSiteConfig()
    return {
        title: 'Privacy Policy',
        subtitle: 'How NestorCut collects, uses and protects your data.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Controller',
                paragraphs: [
                    `The controller of your personal data is the operator of NestorCut. You can contact us at ${supportEmail}.`,
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
                    'On the Pro plan, a zero-knowledge encryption mode is available. When enabled, your files are encrypted with a key generated on your device, which is never transmitted to us in clear text. In this mode we are technically unable to read your files, even in the event of a database compromise.',
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
                    'Google — optional sign-in via Google account;',
                    'Resend — transactional email delivery;',
                    'Our hosting and database provider.',
                ],
            },
            {
                heading: '7. Cookies',
                paragraphs: [
                    'The Service uses only essential cookies and local storage:',
                ],
                list: [
                    'A session cookie, required for authentication;',
                    'An anonymous tracking cookie, for usage statistics;',
                    'A preference cookie, to remember your theme.',
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
                    `To exercise any of these rights, contact us at ${supportEmail}. We will respond within the legal timeframe. You also have the right to lodge a complaint with your data protection authority.`,
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
                    'Requesting a refund does not automatically close your account. To delete your account and the associated data, follow the procedure described in our Privacy Policy.',
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
