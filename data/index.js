import { useSiteConfig } from '~~/data/siteConfig'
import { FREE_NESTING_LIMIT, TRIAL_DAYS, SUBSCRIPTION_PRICE_LABEL, PRO_PRICE_LABEL } from '~~/constants/payment.constants'

export const hero = {
    badge: 'Open source · Inspired by Nest2D',
    title: 'Fit more parts on every sheet.',
    text: 'Upload your DXF files, set your sheet size, and let APlasma Nesting arrange your parts with minimal material waste — built for laser, plasma, plotter and CNC cutting.',
    primaryCta: 'Start nesting for free',
    secondaryCta: 'See how it works',
}
export const highlights = [
    'True-shape nesting',
    'Multi-sheet support',
    'DXF in → DXF out',
    'Private by design',
]
export const features = {
    title: 'Everything you need to stop wasting material',
    subtitle: 'A focused tool that does one thing extremely well: packing your parts as tightly as possible.',
    list: [
        {
            icon: 'nest',
            title: 'True-shape nesting engine',
            text: 'Irregular shapes are rotated and interlocked to squeeze the most out of every sheet — not just bounding boxes.'
        },
        {
            icon: 'layers',
            title: 'Multi-sheet optimization',
            text: 'Nest across as many sheets as your job requires and know exactly how many sheets to load into the machine.'
        },
        {
            icon: 'rotate',
            title: 'Quantities & rotation control',
            text: 'Set per-part quantities and allowed rotations — lock the grain direction when the material demands it.'
        },
        {
            icon: 'server',
            title: 'Server-side computation',
            text: 'The heavy optimization runs on our servers. No installation, no setup — it works from any device, anywhere.'
        },
        {
            icon: 'shield',
            title: 'Private by design',
            text: 'Your files are stored securely and visible only to you. The platform is fully open source — and the Pro plan adds zero-knowledge encryption, so even we cannot read your parts.'
        },
        {
            icon: 'download',
            title: 'Ready-to-cut output',
            text: 'Download the nested layout as DXF for a single sheet, or as a ZIP for the whole job — straight to your machine software.'
        }
    ]
}
export const screenshots = {
    title: 'A workspace designed for the workshop',
    list: {
        ghost: [
            {
                src: '/screenshots/first-ghost.png',
            },
            {
                src: '/screenshots/second-ghost.png',
            },
            {
                src: '/screenshots/third-ghost.png',
            }
        ],
        primary: [
            {
                src: '/screenshots/first-primary.png',
            },
            {
                src: '/screenshots/second-primary.png',
            },
            {
                src: '/screenshots/third-primary.png',
            }
        ]
    }
}
export const howItWorks = {
    title: 'From DXF to cut-ready layout in under a minute',
    list: [
        {
            title: 'Upload your parts',
            text: 'Drag and drop your DXF files. Each part is validated and previewed automatically.'
        },
        {
            title: 'Set your sheet',
            text: 'Enter your material dimensions, spacing and rotation constraints.'
        },
        {
            title: 'Nest & download',
            text: 'Get an optimized, ready-to-cut layout as DXF — and see how much material you saved.'
        }
    ]
}
export const pricing = {
    title: 'Simple pricing that pays for itself',
    subtitle: 'One saved sheet of material usually covers the month.',
    tiers: [
        {
            name: 'Free',
            price: '€0',
            interval: 'forever',
            description: 'To try the engine on your own parts.',
            features: [
                `${FREE_NESTING_LIMIT} free nesting operations`,
                'All core nesting features',
                'DXF & ZIP export',
            ],
            cta: 'Start for free',
            trackingTag: 'pricing_free',
        },
        {
            name: 'Unlimited',
            price: SUBSCRIPTION_PRICE_LABEL,
            interval: 'month',
            description: 'For makers and workshops that nest every week.',
            features: [
                'Unlimited nesting operations',
                'Multi-sheet jobs',
                'Email notifications when a job finishes',
                'Cancel anytime',
            ],
            cta: `Start ${TRIAL_DAYS}-day free trial`,
            trackingTag: 'pricing_unlimited',
            highlighted: true,
            badge: 'Most popular',
        },
        {
            name: 'Pro',
            price: PRO_PRICE_LABEL,
            interval: 'month',
            description: 'For businesses that quote, produce — and demand maximum confidentiality.',
            features: [
                'Everything in Unlimited',
                'Zero-knowledge encryption: only you hold the key, like a crypto wallet',
                'G-code export',
                'Remnant (offcut) management',
                'PDF quote reports',
            ],
            cta: 'Coming soon',
            trackingTag: 'pricing_pro',
            comingSoon: true,
        },
    ]
}
export function useStarted() {
    return {
        title: 'Ready to save material?',
        text: `Create your account and get ${FREE_NESTING_LIMIT} free nesting operations — no credit card required. Then keep going with the Unlimited plan at ${SUBSCRIPTION_PRICE_LABEL}/month, starting with a ${TRIAL_DAYS}-day free trial.`,
        cta: 'Start nesting for free',
    }
}
export function useFaq() {
    const { supportEmail, githubRepo } = useSiteConfig()
    return {
        title: 'Frequently Asked Questions',
        text: 'Stuck on something? We’re here to help with all your questions and answers in one place.',
        list: [
            {
                title: 'Is there a free trial?',
                firstPart: `Yes — twice. Every account starts with ${FREE_NESTING_LIMIT} free nesting operations, no credit card required. After that, the Unlimited subscription begins with a ${TRIAL_DAYS}-day free trial: you are not charged until the trial ends, and you can cancel anytime before then.`
            },
            {
                title: 'How much does APlasma Nesting cost?',
                firstPart: `The Unlimited plan is ${SUBSCRIPTION_PRICE_LABEL}/month and includes unlimited nesting while active. A Pro plan (${PRO_PRICE_LABEL}/month) with G-code export, remnant management and PDF quote reports is coming soon.`
            },
            {
                title: 'Can I pay per use instead of subscribing?',
                firstPart: 'Yes. If you only nest occasionally, credit packs are available — each nesting operation simply consumes credits from your balance. No recurring commitment.'
            },
            {
                title: 'What is your cancellation policy?',
                firstPart: `Things change, and that is fine. You can cancel your subscription at any time. Cancel during the ${TRIAL_DAYS}-day free trial and you will not be charged at all.`
            },
            {
                title: 'What file formats do you support?',
                firstPart: 'Currently, we support DXF files — the standard exchange format for laser, plasma and CNC cutting.'
            },
            {
                title: 'Are my files safe?',
                firstPart: `Your uploaded files and nesting results are stored securely and are only visible to your account. For maximum confidentiality, the upcoming Pro plan (${PRO_PRICE_LABEL}/month) adds zero-knowledge encryption — your files are encrypted with a key only you hold, so even we cannot read them. And because APlasma Nesting is fully open source, you don’t have to take our word for it — you can read the code.`
            },
            {
                title: 'What happens if I lose my key file?',
                firstPart: 'With zero-knowledge encryption (Pro plan), your key file is the ONLY way to read your files. We never store a copy — not in our database, not in our backups. If you lose it, your encrypted files are permanently unreadable, and no one can recover them, including us. Keep several copies of your key file in safe places.'
            },
            {
                title: 'Does APlasma Nesting give the best possible results?',
                firstPart: 'While achieving perfect nesting optimization is a complex computational challenge with no guaranteed optimal solution, APlasma Nesting delivers highly efficient material layouts through advanced algorithms. Our system prioritizes both speed and optimization quality to provide practical, time-saving results for your cutting projects.'
            },
            {
                title: 'Can I contribute to the project?',
                firstPart: 'Absolutely! Check out our',
                link: 'GitHub repository',
                linkHref: githubRepo,
                target: '_blank',
                secondPart: 'to contribute.'
            },
            {
                title: 'I still have questions.',
                firstPart: 'Feel free to contact me via the support chat or by email at',
                link: supportEmail,
                linkHref: `mailto:${supportEmail}`,
            },
        ]
    }
}
export function useRefund() {
    const { supportEmail } = useSiteConfig()
    return {
        title: 'Refunds',
        firstPart: 'My business philosophy is that if you, as a customer, are not happy, then I’m not happy. I have a 30-day, no-questions-asked refund policy. Please email',
        link: supportEmail,
        linkHref: `mailto:${supportEmail}`,
        secondPart: 'for a full refund. I’d appreciate it if you could share the reason you are unhappy with the purchase, but doing so is not necessary for a refund.'
    }
}
