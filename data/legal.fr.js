/**
 * Contenu légal (français) pour APlasma Nesting.
 *
 * Utilisé par pages/terms-and-conditions.vue, pages/privacy.vue, pages/refund.vue
 * lorsque la locale active est le français. Contrepartie de data/legal.en.js.
 *
 * REMARQUE — Ces textes sont des modèles à vocation générale, rédigés pour un
 * SaaS auto-hébergé. Ils ne remplacent pas l'avis d'un avocat qualifié et
 * familier avec la juridiction de l'exploitant. Ce dernier reste responsable
 * de les faire valider avant une mise en service commerciale.
 */
import { useSiteConfig } from '~~/data/siteConfig'

const TODAY = new Date().toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
})

export function useTerms() {
    const { supportEmail, githubRepo } = useSiteConfig()
    return {
        title: 'Conditions Générales d\'Utilisation',
        subtitle: 'Les règles qui encadrent votre utilisation d\'APlasma Nesting.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Acceptation des conditions',
                paragraphs: [
                    'Les présentes Conditions Générales d\'Utilisation (« CGU ») régissent votre accès et votre utilisation du site APlasma Nesting et de son service de nesting (« le Service »), exploités par le responsable du projet (« nous », « notre » ou « nos »).',
                    'En créant un compte ou en utilisant le Service de quelque manière que ce soit, vous reconnaissez avoir lu, compris et accepté les présentes CGU. Si vous n\'acceptez pas tout ou partie de ces conditions, vous ne devez pas utiliser le Service.',
                    'Vous devez être âgé(e) d\'au moins 16 ans, ou de l\'âge du consentement numérique dans votre pays, pour créer un compte. En utilisant le Service, vous déclarez remplir cette condition.',
                ],
            },
            {
                heading: '2. Description du Service',
                paragraphs: [
                    'APlasma Nesting est un outil en ligne qui dispose des pièces à découper (fichiers DXF) sur des plaques de matière afin d\'en minimiser les chutes. Il s\'adresse aux professionnels et particuliers pratiquant la découpe laser, plasma, traceur et CNC.',
                    'Le Service met en œuvre des heuristiques d\'optimisation. Les dispositions produites sont efficaces mais, comme tout solveur de nesting, ne sont pas mathématiquement garanties comme optimales. Vous restez seul responsable de la vérification de toute disposition avant la découpe de la matière.',
                ],
            },
            {
                heading: '3. Compte et identifiants',
                paragraphs: [
                    'Vous êtes responsable de la confidentialité de votre mot de passe et de votre session, ainsi que de toute activité réalisée depuis votre compte. Signalez-nous sans délai toute utilisation non autorisée.',
                    'Lorsque la fonction de chiffrement zero-knowledge (plan Pro) est activée, un fichier de clé est généré côté client et constitue le seul moyen de lire vos fichiers chiffrés. Nous n\'en conservons aucune copie. En cas de perte, vos fichiers chiffrés deviennent définitivement illisibles et personne — y compris nous — ne pourra les récupérer.',
                ],
            },
            {
                heading: '4. Offres, facturation et crédits',
                paragraphs: [
                    'Le Service propose une offre gratuite, un abonnement mensuel (« Unlimited ») et une offre supérieure (« Pro »). Les tarifs et quotas inclus sont décrits sur la page des tarifs et peuvent évoluer ; les changements ne prennent effet que pour les périodes de facturation futures.',
                    'Les paiements sont traités par notre prestataire de paiement, Stripe. Nous ne recevons ni ne stockons jamais vos données bancaires complètes. Les abonnements débutent par une période d\'essai gratuite durant laquelle vous n\'êtes pas facturé ; à l\'issue de l\'essai, la facturation est récurrente jusqu\'à résiliation.',
                    'Les packs de crédits, lorsqu\'ils sont proposés, sont consommés à chaque opération de nesting. Sauf obligation légale, les crédits et abonnements ne sont pas remboursables, sauf dans les conditions prévues par notre Politique de remboursement.',
                    'Vous pouvez résilier un abonnement à tout moment depuis votre compte. La résiliation prend effet à la fin de la période de facturation en cours.',
                ],
            },
            {
                heading: '5. Vos fichiers et contenus',
                paragraphs: [
                    'Vous conservez l\'ensemble des droits de propriété intellectuelle sur les fichiers que vous téléversez. Nous les traitons uniquement pour exécuter le nesting et en stocker les résultats afin que vous puissiez les télécharger.',
                    'Vous garantissez détenir les droits sur les fichiers que vous téléversez et que leur traitement ne porte pas atteinte aux droits de tiers.',
                    'Consultez notre Politique de confidentialité pour le détail du stockage, de la conservation et (sur le plan Pro) du chiffrement des fichiers.',
                ],
            },
            {
                heading: '6. Utilisation acceptable',
                paragraphs: [
                    'Vous vous engagez à ne pas :',
                ],
                list: [
                    'Utiliser le Service à des fins illicites, frauduleuses ou nuisibles ;',
                    'Tenter d\'accéder aux fichiers, au compte ou aux données d\'un autre utilisateur sans autorisation ;',
                    'Interrompre, surcharger ou faire de l\'ingénierie inverse du Service ou de son infrastructure ;',
                    'Téléverser des contenus contenant des logiciels malveillants ou conçus pour exploiter une vulnérabilité.',
                ],
            },
            {
                heading: '7. Licence open-source du code source',
                paragraphs: [
                    'Le code source d\'APlasma Nesting est distribué sous licence MIT. Les présentes CGU régissent l\'utilisation du Service hébergé ; l\'utilisation, la modification et la redistribution du code source restent régies par la licence MIT, disponible sur le dépôt du projet.',
                ],
            },
            {
                heading: '8. Limitation de responsabilité',
                paragraphs: [
                    'Le Service est fourni « en l\'état » et « selon disponibilité ». Dans la mesure maximale permise par la loi, nous déclinons toute responsabilité pour tout dommage direct, indirect, accessoire ou consécutif résultant de l\'utilisation ou de l\'impossibilité d\'utiliser le Service.',
                    'Le nesting est un processus heuristique : nous ne garantissons ni des résultats optimaux, ni l\'absence d\'erreurs dans les dispositions générées.',
                    'La sécurité de la plateforme fait l\'objet d\'une revue régulière. Toutefois, compte tenu de la complexité inhérente du logiciel et de la dépendance à des outils et bibliothèques tiers, nous ne saurions être tenus responsables de failles non découvertes affectant ces composants tiers.',
                    'Nous ne garantissons pas que le Service sera ininterrompu ou exempt d\'erreurs, ni que les résultats obtenus répondront à vos besoins spécifiques.',
                ],
            },
            {
                heading: '9. Suspension et résiliation',
                paragraphs: [
                    'Nous pouvons suspendre ou résilier l\'accès au Service, sans préavis, en cas de manquement aux présentes CGU, à la loi applicable, ou pour protéger l\'intégrité du Service.',
                    'En cas de résiliation, votre droit d\'utilisation du Service prend fin. Les fichiers stockés pourront être supprimés après un délai raisonnable, sauf obligation de conservation légale.',
                ],
            },
            {
                heading: '10. Modification des CGU',
                paragraphs: [
                    'Nous pouvons mettre à jour les présentes CGU pour refléter les évolutions du Service ou de la réglementation applicable. Les modifications substantielles seront notifiées par email ou par un avis sur le Service. La poursuite de l\'utilisation après l\'entrée en vigueur des modifications vaut acceptation des CGU révisées.',
                ],
            },
            {
                heading: '11. Droit applicable',
                paragraphs: [
                    'Les présentes CGU sont régies par le droit du pays dans lequel l\'exploitant du Service est établi, à l\'exclusion des règles de conflit de lois. Tout litige qui ne pourrait être résolu à l\'amiable sera soumis aux tribunaux compétents de cette juridiction.',
                ],
            },
        ],
        contact: {
            intro: 'Pour toute question relative aux présentes CGU, contactez-nous à',
            email: supportEmail,
            outro: 'ou ouvrez un ticket sur le dépôt GitHub du projet.',
        },
    }
}

export function usePrivacy() {
    const { supportEmail } = useSiteConfig()
    return {
        title: 'Politique de confidentialité',
        subtitle: 'La manière dont APlasma Nesting collecte, utilise et protège vos données.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Responsable du traitement',
                paragraphs: [
                    `Le responsable du traitement de vos données à caractère personnel est l'exploitant d'APlasma Nesting. Vous pouvez nous contacter à l'adresse ${supportEmail}.`,
                ],
            },
            {
                heading: '2. Données collectées',
                paragraphs: [
                    'Nous ne collectons que les données strictement nécessaires à la fourniture du Service :',
                ],
                list: [
                    'Données de compte : adresse email (utilisée comme identifiant), nom affiché, mot de passe haché.',
                    'Contenus téléversés : les fichiers DXF que vous soumettez et les résultats de nesting que nous générons pour vous.',
                    'Données techniques : adresse IP, type de navigateur, événements d\'usage (vues de pages, clics) collectés via notre tracking interne, pour l\'exploitation et l\'amélioration du Service.',
                    'Données de facturation : traitées par Stripe. Nous ne conservons qu\'une référence à votre client Stripe et au statut de votre abonnement — jamais vos données bancaires.',
                ],
            },
            {
                heading: '3. Finalités et base légale',
                paragraphs: [
                    'Vos données sont traitées aux fins suivantes :',
                ],
                list: [
                    'Fourniture du Service de nesting (exécution du contrat) ;',
                    'Gestion du compte et authentification (intérêt légitime) ;',
                    'Facturation et gestion des abonnements (exécution du contrat) ;',
                    'Sécurité, prévention de la fraude et de l\'abus (intérêt légitime) ;',
                    'Amélioration du Service et statistiques, anonymisées lorsque c\'est possible (intérêt légitime).',
                ],
            },
            {
                heading: '4. Stockage et chiffrement des fichiers',
                paragraphs: [
                    'Vos fichiers téléversés et résultats de nesting sont stockés dans notre base de données et ne sont accessibles qu\'à partir de votre compte.',
                    'Sur le plan Pro, un mode de chiffrement zero-knowledge est disponible. Lorsqu\'il est activé, vos fichiers sont chiffrés avec une clé générée sur votre appareil, qui ne nous est jamais transmise en clair. Dans ce mode, nous sommes techniquement incapables de lire vos fichiers, y compris en cas de compromission de la base de données.',
                ],
            },
            {
                heading: '5. Conservation des données',
                paragraphs: [
                    'Les données de compte et les fichiers sont conservés tant que votre compte est actif. Après suppression, les données sont purgées dans un délai raisonnable, sauf obligation de conservation légale.',
                    'Les journaux techniques sont conservés pendant une durée limitée, compatible avec les besoins de sécurité, puis automatiquement supprimés.',
                ],
            },
            {
                heading: '6. Sous-traitants',
                paragraphs: [
                    'Nous recourons aux tiers de confiance suivants, agissant chacun en qualité de sous-traitant :',
                ],
                list: [
                    'Stripe — traitement des paiements (certifié PCI-DSS) ;',
                    'Google — connexion optionnelle via le compte Google ;',
                    'Resend — délivrabilité des emails transactionnels ;',
                    'Notre prestataire d\'hébergement et de base de données.',
                ],
            },
            {
                heading: '7. Cookies',
                paragraphs: [
                    'Le Service utilise uniquement des cookies et du stockage local essentiels :',
                ],
                list: [
                    'Un cookie de session, nécessaire à l\'authentification ;',
                    'Un cookie de suivi anonyme, à des fins statistiques ;',
                    'Un cookie de préférence, pour mémoriser votre thème.',
                ],
            },
            {
                heading: '8. Sécurité',
                paragraphs: [
                    'Nous mettons en œuvre des mesures techniques et organisationnelles raisonnables pour protéger vos données : hachage des mots de passe, chiffrement des communications (TLS), contrôles d\'accès aux fichiers par utilisateur, et une couche de chiffrement zero-knowledge optionnelle.',
                    'La sécurité de la plateforme fait l\'objet d\'une revue régulière. Toutefois, la sécurité logicielle ne peut jamais être garantie de façon absolue, et notre Service repose sur des outils et bibliothèques tiers. Nous ne saurions être tenus responsables de failles non découvertes affectant ces composants tiers.',
                ],
            },
            {
                heading: '9. Vos droits',
                paragraphs: [
                    'Selon votre juridiction (notamment au titre du RGPD si vous résidez dans l\'Union européenne), vous disposez des droits suivants sur vos données à caractère personnel :',
                ],
                list: [
                    'Droit d\'accès à vos données ;',
                    'Droit de rectification ;',
                    'Droit à l\'effacement (« droit à l\'oubli ») ;',
                    'Droit à la limitation ou à l\'opposition au traitement ;',
                    'Droit à la portabilité des données ;',
                    'Droit de retirer votre consentement à tout moment, sans porter atteinte à la licéité du traitement antérieur.',
                ],
            },
            {
                heading: '10. Exercice de vos droits',
                paragraphs: [
                    `Pour exercer ces droits, contactez-nous à ${supportEmail}. Nous répondrons dans le délai légal. Vous disposez également du droit d'introduire une réclamation auprès de votre autorité de protection des données.`,
                ],
            },
        ],
        contact: {
            intro: 'Des questions de confidentialité ? Écrivez à',
            email: supportEmail,
            outro: '.',
        },
    }
}

export function useRefund() {
    const { supportEmail } = useSiteConfig()
    return {
        title: 'Politique de remboursement',
        subtitle: 'Notre engagement pour des remboursements simples et équitables.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Garantie satisfait ou remboursé 30 jours',
                paragraphs: [
                    'La satisfaction de nos clients est notre priorité. Si vous n\'êtes pas satisfait d\'un abonnement payant, vous pouvez demander un remboursement intégral dans les 30 jours suivant le débit, sans justification.',
                    'Cette garantie s\'applique à la première période de facturation d\'un abonnement. Les renouvellements ne sont remboursables que dans des circonstances exceptionnelles (par exemple, une interruption de service de notre fait).',
                ],
            },
            {
                heading: '2. Crédits et achats ponctuels',
                paragraphs: [
                    'Les packs de crédits sont consommés au fur et à mesure de votre utilisation du Service. Les crédits non utilisés ne sont pas remboursables, sauf dans les 14 jours suivant l\'achat, à condition qu\'ils n\'aient pas été utilisés et que le droit de rétractation soit exercé.',
                ],
            },
            {
                heading: '3. Essai gratuit',
                paragraphs: [
                    'L\'essai gratuit vous permet d\'évaluer le Service sans être facturé. Si vous annulez avant la fin de l\'essai, vous ne serez pas facturé du tout. Aucun remboursement n\'est nécessaire dans ce cas, aucun paiement n\'ayant été prélevé.',
                ],
            },
            {
                heading: '4. Comment demander un remboursement',
                paragraphs: [
                    `Adressez votre demande à ${supportEmail}, en indiquant votre compte (adresse email) et, le cas échéant, la facture concernée.`,
                    'Nous traiterons votre demande dans les meilleurs délais et en tout état de cause dans les 14 jours de sa réception. Le remboursement sera effectué via le moyen de paiement initial.',
                ],
            },
            {
                heading: '5. Fermeture de compte',
                paragraphs: [
                    'Demander un remboursement ne clôt pas automatiquement votre compte. Pour supprimer votre compte et les données associées, suivez la procédure décrite dans notre Politique de confidentialité.',
                ],
            },
        ],
        contact: {
            intro: 'Une question sur un remboursement ? Contactez',
            email: supportEmail,
            outro: '.',
        },
    }
}
