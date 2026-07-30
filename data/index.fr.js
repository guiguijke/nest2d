import { useSiteConfig } from '~~/data/siteConfig'
import { FREE_NESTING_LIMIT, TRIAL_DAYS, SUBSCRIPTION_PRICE_LABEL, PRO_PRICE_LABEL } from '~~/shared/constants/payment.constants'

export const hero = {
    badge: 'Moteur de nesting de pointe · Inspiré de Nest2D',
    title: 'Logez plus de pièces sur chaque plaque.',
    text: 'Importez vos fichiers DXF, définissez votre plaque, et laissez notre moteur issu de la recherche tasser vos pièces au plus dense — en quelques secondes. Conçu pour la découpe laser, plasma, jet d\'eau, traceur et CNC.',
    primaryCta: 'Commencer gratuitement',
    secondaryCta: 'Voir comment ça marche',
}
export const highlights = [
    'Imbrication true-shape',
    'Multi-plaques',
    'DXF entrée → DXF sortie',
    'Confidentiel par conception',
]
export const features = {
    title: 'Tout ce qu\'il faut pour arrêter de gaspiller du matériel',
    subtitle: 'Un outil ciblé qui fait une chose extrêmement bien : ranger vos pièces le plus densément possible.',
    list: [
        {
            icon: 'nest',
            title: 'Moteur d\'imbrication true-shape',
            text: 'Les formes irrégulières sont pivotées et imbriquées pour tirer le maximum de chaque plaque — pas seulement les boîtes englobantes.'
        },
        {
            icon: 'layers',
            title: 'Optimisation multi-plaques',
            text: 'Imbriquez sur autant de plaques que votre travail l\'exige et sachez exactement combien de plaques charger dans la machine.'
        },
        {
            icon: 'rotate',
            title: 'Quantités & contrôle des rotations',
            text: 'Définissez les quantités par pièce et les rotations autorisées — verrouillez le sens des fibres quand le matériau l\'exige.'
        },
        {
            icon: 'server',
            title: 'Calcul côté serveur',
            text: 'L\'optimisation lourde s\'exécute sur nos serveurs. Aucune installation, aucune configuration — ça fonctionne depuis n\'importe quel appareil, n\'importe où.'
        },
        {
            icon: 'shield',
            title: 'Confidentiel par conception',
            text: 'Vos fichiers sont stockés en toute sécurité et visibles uniquement par vous. La plateforme est entièrement open source — et l\'offre Pro ajoute le chiffrement zero-knowledge, pour que même nous ne puissions pas lire vos pièces.'
        },
        {
            icon: 'download',
            title: 'Sortie prête à découper',
            text: 'Téléchargez l\'agencement imbriqué en DXF pour une seule plaque, ou en ZIP pour tout le travail — directement vers le logiciel de votre machine.'
        }
    ]
}
export const screenshots = {
    title: 'Un espace de travail pensé pour l\'atelier',
    list: {
        ghost: [
            { src: '/screenshots/first-ghost.png' },
            { src: '/screenshots/second-ghost.png' },
            { src: '/screenshots/third-ghost.png' }
        ],
        primary: [
            { src: '/screenshots/first-primary.png' },
            { src: '/screenshots/second-primary.png' },
            { src: '/screenshots/third-primary.png' }
        ]
    }
}
export const howItWorks = {
    title: 'Du DXF au tracé prêt à découper en moins d\'une minute',
    list: [
        {
            title: 'Importez vos pièces',
            text: 'Glissez-déposez vos fichiers DXF. Chaque pièce est validée et prévisualisée automatiquement.'
        },
        {
            title: 'Réglez votre plaque',
            text: 'Saisissez les dimensions de votre matériau, l\'espacement et les contraintes de rotation.'
        },
        {
            title: 'Imbriquez & téléchargez',
            text: 'Obtenez un agencement optimisé, prêt à découper en DXF — et voyez combien de matériau vous avez économisé.'
        }
    ]
}
export const pricing = {
    title: 'Une tarification simple qui se rentabilise',
    subtitle: 'Une seule plaque de matériau économisée couvre généralement le mois.',
    tiers: [
        {
            name: 'Gratuit',
            price: '€0',
            interval: 'pour toujours',
            description: 'Pour tester le moteur sur vos propres pièces.',
            features: [
                `${FREE_NESTING_LIMIT} imbrications gratuites chaque mois`,
                'Toutes les fonctions d\'imbrication de base',
                'Export DXF & ZIP',
            ],
            cta: 'Commencer gratuitement',
            trackingTag: 'pricing_free',
        },
        {
            name: 'Illimité',
            price: SUBSCRIPTION_PRICE_LABEL,
            interval: 'mois',
            description: 'Pour les créateurs et ateliers qui imbriquent chaque semaine.',
            features: [
                'Imbrications illimitées',
                'Travaux multi-plaques',
                'Notifications e-mail à la fin d\'un travail',
                'Annulation à tout moment',
            ],
            cta: `Essai gratuit de ${TRIAL_DAYS} jours`,
            trackingTag: 'pricing_unlimited',
            highlighted: true,
            badge: 'Le plus populaire',
        },
        {
            name: 'Pro',
            price: PRO_PRICE_LABEL,
            interval: 'mois',
            description: 'Pour les entreprises qui exigent une confidentialité maximale et les agencements les plus denses.',
            features: [
                'Tout l\'Illimité',
                'Chiffrement zero-knowledge : vous seul détenez la clé, comme un portefeuille crypto',
                'Budget de calcul maximal — des imbrications nettement plus denses',
                'File prioritaire : vos travaux sont traités en premier',
            ],
            cta: 'Bientôt disponible',
            trackingTag: 'pricing_pro',
            comingSoon: true,
        },
    ]
}
export function useStarted() {
    return {
        title: 'Prêt à économiser du matériau ?',
        text: `Créez votre compte et bénéficiez de ${FREE_NESTING_LIMIT} imbrications gratuites chaque mois — sans carte bancaire. Poursuivez avec l'offre Illimité à ${SUBSCRIPTION_PRICE_LABEL}/mois, à partir d'un essai gratuit de ${TRIAL_DAYS} jours.`,
        cta: 'Commencer gratuitement',
    }
}
export function useFaq() {
    const { supportEmail, githubRepo } = useSiteConfig()
    return {
        title: 'Questions fréquentes',
        text: 'Bloqué sur quelque chose ? Nous sommes là pour vous aider avec toutes vos questions et réponses au même endroit.',
        list: [
            {
                title: 'Y a-t-il un essai gratuit ?',
                firstPart: `Oui — deux fois. Chaque compte dispose de ${FREE_NESTING_LIMIT} imbrications gratuites par mois, sans carte bancaire. Ensuite, l'abonnement Illimité commence par un essai gratuit de ${TRIAL_DAYS} jours : vous n'êtes pas facturé avant la fin de l'essai, et vous pouvez annuler à tout moment d'ici là.`
            },
            {
                title: 'Combien coûte NestorCut ?',
                firstPart: `L'offre Illimité est à ${SUBSCRIPTION_PRICE_LABEL}/mois et inclut des imbrications illimitées tant qu'elle est active. L'offre Pro (${PRO_PRICE_LABEL}/mois) ajoute le chiffrement zero-knowledge, le budget de calcul maximal pour des agencements plus denses, et un traitement prioritaire de vos travaux.`
            },
            {
                title: 'Puis-je payer à l\'usage plutôt que m\'abonner ?',
                firstPart: 'Oui. Si vous n\'imbriquez qu\'occasionnellement, des packs de crédits sont disponibles — chaque opération d\'imbrication consomme simplement des crédits depuis votre solde. Sans engagement récurrent.'
            },
            {
                title: 'Quelle est votre politique d\'annulation ?',
                firstPart: `Les choses changent, et c'est très bien. Vous pouvez annuler votre abonnement à tout moment. Annulez pendant l'essai gratuit de ${TRIAL_DAYS} jours et vous ne serez pas facturé du tout.`
            },
            {
                title: 'Quels formats de fichier supportez-vous ?',
                firstPart: 'Actuellement, nous supportons les fichiers DXF — le format d\'échange standard pour la découpe laser, plasma et CN.'
            },
            {
                title: 'Mes fichiers sont-ils en sécurité ?',
                firstPart: `Vos fichiers importés et résultats d'imbrication sont stockés en toute sécurité et ne sont visibles que par votre compte. Pour une confidentialité maximale, l'offre Pro (${PRO_PRICE_LABEL}/mois) ajoute le chiffrement zero-knowledge — vos fichiers sont chiffrés avec une clé que vous seul détenez, pour que même nous ne puissions pas les lire. Et comme NestorCut est entièrement open source, vous n'avez pas à nous croire sur parole — vous pouvez lire le code.`
            },
            {
                title: 'Que se passe-t-il si je perds mon fichier-clé ?',
                firstPart: 'Avec le chiffrement zero-knowledge (offre Pro), votre fichier-clé est le SEUL moyen de lire vos fichiers. Nous n\'en stockons jamais de copie — ni dans notre base, ni dans nos sauvegardes. Si vous le perdez, vos fichiers chiffrés sont définitivement illisibles, et personne ne peut les récupérer, nous y compris. Conservez plusieurs copies de votre fichier-clé en des lieux sûrs.'
            },
            {
                title: 'NestorCut donne-t-il les meilleurs résultats possibles ?',
                firstPart: 'Bien que l\'imbrication parfaite soit un défi computationnel complexe sans solution optimale garantie, NestorCut produit des agencements de matériau très efficaces grâce à des algorithmes avancés. Notre système privilégie à la fois la vitesse et la qualité d\'optimisation pour fournir des résultats pratiques et gain de temps pour vos projets de découpe.'
            },
            {
                title: 'La plateforme est-elle sécurisée ? Est-elle auditée ?',
                firstPart: 'La sécurité est intégrée à la plateforme et revue régulièrement : mots de passe hachés, transport chiffré (TLS), contrôles d\'accès par utilisateur sur les fichiers, et une couche optionnelle de chiffrement zero-knowledge sur l\'offre Pro. Le code étant entièrement open source, il est consultable par quiconque. Ceci dit, la sécurité logicielle ne peut jamais être garantie absolument, et le Service repose sur des outils et bibliothèques tiers — nous ne pouvons être tenus responsables des vulnérabilités qui resteraient indétectées dans ces composants tiers.'
            },
            {
                title: 'Puis-je contribuer au projet ?',
                firstPart: 'Absolument ! Consultez notre',
                link: 'dépôt GitHub',
                linkHref: githubRepo,
                target: '_blank',
                secondPart: 'pour contribuer.'
            },
            {
                title: 'J\'ai encore des questions.',
                firstPart: 'N\'hésitez pas à nous contacter via le chat de support ou par e-mail à',
                link: supportEmail,
                linkHref: `mailto:${supportEmail}`,
            },
        ]
    }
}
export function useRefund() {
    return {
        title: 'Pas satisfait ? Faites-vous rembourser',
        firstPart: 'Nous croyons en notre Service. Si un abonnement payant ne répond pas à vos attentes, vous pouvez demander un remboursement intégral sous 30 jours — sans justification.',
        link: 'Lire la politique de remboursement complète',
        linkHref: '/refund',
        secondPart: 'pour les détails et la procédure.',
    }
}
