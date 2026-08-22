/**
 * Contenu légal (français) pour NestorCut.
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

export function useLegalNotice() {
    const { supportEmail, legal } = useSiteConfig()
    return {
        title: 'Mentions Légales',
        subtitle: 'Informations exigées par la loi française (article 6 de la LCEN).',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Éditeur du Service',
                paragraphs: [
                    `Le site et l'application NestorCut (« NestorCut by ${legal.tradeName} ») sont édités par :`,
                ],
                list: [
                    `${legal.entityName} — nom commercial : ${legal.tradeName}`,
                    `SIREN : ${legal.siren}`,
                    `Adresse : ${legal.address}`,
                    `Téléphone : ${legal.phone}`,
                    legal.vatNote,
                    `Contact : ${supportEmail}`,
                ],
            },
            {
                heading: '2. Directeur de la publication',
                paragraphs: [
                    `Le directeur de la publication est le représentant légal de ${legal.entityName}.`,
                ],
            },
            {
                heading: '3. Hébergement',
                paragraphs: [
                    'Le site vitrine (nestorcut.com) est hébergé par Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis.',
                    `L'application (app.nestorcut.com), sa base de données et les fichiers que vous importez sont hébergés sur une infrastructure exploitée par ${legal.entityName} (${legal.tradeName}), située en France.`,
                ],
            },
            {
                heading: '4. Propriété intellectuelle',
                paragraphs: [
                    `Le nom, le logo et l'identité visuelle NestorCut sont la propriété de ${legal.entityName} (${legal.tradeName}). La structure et le contenu de ce site ne peuvent être reproduits sans autorisation écrite préalable.`,
                    'Le code source de l\'application est distribué sous Licence MIT et reste régi par celle-ci.',
                ],
            },
            {
                heading: '5. Responsabilité',
                paragraphs: [
                    'L\'éditeur s\'efforce de fournir des informations exactes et à jour, mais ne saurait être tenu responsable des erreurs, omissions ou interruptions de service, ni du contenu des sites tiers vers lesquels des liens sont proposés.',
                ],
            },
        ],
        contact: {
            intro: 'Une question d\'ordre juridique ? Écrivez à',
            email: supportEmail,
            outro: '.',
        },
    }
}

export function useTerms() {
    const { supportEmail, githubRepo, legal } = useSiteConfig()
    return {
        title: 'Conditions Générales d\'Utilisation',
        subtitle: 'Les règles qui encadrent votre utilisation de NestorCut.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Acceptation des conditions',
                paragraphs: [
                    `Les présentes Conditions Générales d'Utilisation (« CGU ») régissent votre accès et votre utilisation du site NestorCut et de son service d'imbrication (« le Service »), édités par ${legal.entityName} — nom commercial « ${legal.tradeName} », SIREN ${legal.siren} (« nous », « notre » ou « nos »).`,
                    'En créant un compte ou en utilisant le Service de quelque manière que ce soit, vous reconnaissez avoir lu, compris et accepté les présentes CGU. Si vous n\'acceptez pas tout ou partie de ces conditions, vous ne devez pas utiliser le Service.',
                    'Vous devez être âgé(e) d\'au moins 16 ans, ou de l\'âge du consentement numérique dans votre pays, pour créer un compte. En utilisant le Service, vous déclarez remplir cette condition.',
                ],
            },
            {
                heading: '2. Description du Service',
                paragraphs: [
                    'NestorCut est un outil en ligne qui dispose des pièces à découper (fichiers DXF) sur des plaques de matière afin d\'en minimiser les chutes. Il s\'adresse aux professionnels et particuliers pratiquant la découpe laser, plasma, traceur et CNC.',
                    'Le Service met en œuvre des heuristiques d\'optimisation. Les dispositions produites sont efficaces mais, comme tout solveur d\'imbrication, ne sont pas mathématiquement garanties comme optimales. Vous restez seul responsable de la vérification de toute disposition avant la découpe de la matière.',
                ],
            },
            {
                heading: '3. Compte et identifiants',
                paragraphs: [
                    'Vous êtes responsable de la confidentialité de votre mot de passe et de votre session, ainsi que de toute activité réalisée depuis votre compte. Signalez-nous sans délai toute utilisation non autorisée.',
                    'Lorsque le coffre de chiffrement zero-knowledge (optionnel, disponible sur tous les plans) est activé, un fichier de clé est généré côté client et constitue le seul moyen de lire vos fichiers chiffrés. Nous n\'en conservons aucune copie. En cas de perte, vos fichiers chiffrés deviennent définitivement illisibles et personne — y compris nous — ne pourra les récupérer.',
                ],
            },
            {
                heading: '4. Offres, facturation et crédits',
                paragraphs: [
                    'Le Service propose une offre gratuite, un abonnement mensuel (« Unlimited ») et une offre supérieure (« Pro »). Les tarifs et quotas inclus sont décrits sur la page des tarifs et peuvent évoluer ; les changements ne prennent effet que pour les périodes de facturation futures.',
                    'Les paiements sont traités par notre prestataire de paiement, Stripe. Nous ne recevons ni ne stockons jamais vos données bancaires complètes. Les abonnements débutent par une période d\'essai gratuite durant laquelle vous n\'êtes pas facturé ; à l\'issue de l\'essai, la facturation est récurrente jusqu\'à résiliation.',
                    'Les packs de crédits, lorsqu\'ils sont proposés, sont consommés à chaque opération d\'imbrication. Sauf obligation légale, les crédits et abonnements ne sont pas remboursables, sauf dans les conditions prévues par notre Politique de remboursement.',
                    'Vous pouvez résilier un abonnement à tout moment depuis votre compte. La résiliation prend effet à la fin de la période de facturation en cours.',
                    `Les prix sont affichés en euros. ${legal.vatNote}.`,
                ],
            },
            {
                heading: '5. Vos fichiers et contenus',
                paragraphs: [
                    'Vous conservez l\'ensemble des droits de propriété intellectuelle sur les fichiers que vous téléversez. Nous les traitons uniquement pour exécuter l\'imbrication et en stocker les résultats afin que vous puissiez les télécharger.',
                    'Vous garantissez détenir les droits sur les fichiers que vous téléversez et que leur traitement ne porte pas atteinte aux droits de tiers.',
                    'Consultez notre Politique de confidentialité pour le détail du stockage, de la conservation et, en option, du chiffrement zero-knowledge (disponible sur tous les plans).',
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
                    'Le code source de NestorCut est distribué sous licence MIT. Les présentes CGU régissent l\'utilisation du Service hébergé ; l\'utilisation, la modification et la redistribution du code source restent régies par la licence MIT, disponible sur le dépôt du projet.',
                ],
            },
            {
                heading: '8. Limitation de responsabilité',
                paragraphs: [
                    'Le Service est fourni « en l\'état » et « selon disponibilité ». Dans la mesure maximale permise par la loi, nous déclinons toute responsabilité pour tout dommage direct, indirect, accessoire ou consécutif résultant de l\'utilisation ou de l\'impossibilité d\'utiliser le Service.',
                    'L\'imbrication est un processus heuristique : nous ne garantissons ni des résultats optimaux, ni l\'absence d\'erreurs dans les dispositions générées.',
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
                heading: '11. Droit applicable et juridiction',
                paragraphs: [
                    'Les présentes CGU sont régies par le droit français. Tout litige qui ne pourrait être résolu à l\'amiable sera soumis aux tribunaux français compétents du ressort du siège de l\'éditeur.',
                    'Si vous êtes un consommateur résidant dans l\'Union européenne, aucune disposition des présentes ne vous prive des protections impératives accordées par le droit de votre pays de résidence.',
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
    const { supportEmail, legal } = useSiteConfig()
    return {
        title: 'Politique de confidentialité',
        subtitle: 'La manière dont NestorCut collecte, utilise et protège vos données.',
        effectiveDate: TODAY,
        sections: [
            {
                heading: '1. Responsable du traitement',
                paragraphs: [
                    `Le responsable du traitement de vos données à caractère personnel est ${legal.entityName} — nom commercial « ${legal.tradeName} », SIREN ${legal.siren}, éditeur de NestorCut (« NestorCut by ${legal.tradeName} »). Vous pouvez nous contacter à l'adresse ${supportEmail}.`,
                    'Vos données sont hébergées et traitées en France.',
                ],
            },
            {
                heading: '2. Données collectées',
                paragraphs: [
                    'Nous ne collectons que les données strictement nécessaires à la fourniture du Service :',
                ],
                list: [
                    'Données de compte : adresse email (utilisée comme identifiant), nom affiché, mot de passe haché.',
                    'Contenus téléversés : les fichiers DXF que vous soumettez et les résultats d\'imbrication que nous générons pour vous.',
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
                    'Fourniture du Service d\'imbrication (exécution du contrat) ;',
                    'Gestion du compte et authentification (intérêt légitime) ;',
                    'Facturation et gestion des abonnements (exécution du contrat) ;',
                    'Sécurité, prévention de la fraude et de l\'abus (intérêt légitime) ;',
                    'Amélioration du Service et statistiques, anonymisées lorsque c\'est possible (intérêt légitime).',
                ],
            },
            {
                heading: '4. Stockage et chiffrement des fichiers',
                paragraphs: [
                    'Vos fichiers téléversés et résultats d\'imbrication sont stockés dans notre base de données et ne sont accessibles qu\'à partir de votre compte.',
                    'Un coffre de chiffrement zero-knowledge est disponible en option sur tous les plans. Lorsqu\'il est activé, vos fichiers sont chiffrés avec une clé générée sur votre appareil, qui ne nous est jamais transmise en clair. Dans ce mode, nous sommes techniquement incapables de lire vos fichiers, y compris en cas de compromission de la base de données.',
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
                    'Google — connexion optionnelle via le compte Google, et mesure d\'audience sur le site vitrine (Google Analytics 4, IP anonymisée, fonctions publicitaires désactivées) ;',
                    'Resend — délivrabilité des emails transactionnels ;',
                    'Cloudflare — hébergement et diffusion du site vitrine (nestorcut.com).',
                ],
            },
            {
                heading: '7. Cookies et traceurs',
                paragraphs: [
                    'NestorCut n\'utilise que des cookies strictement nécessaires au Service, ainsi qu\'un outil de mesure d\'audience exempté. Aucun cookie publicitaire ni de suivi inter-sites n\'est utilisé — c\'est pourquoi aucun bandeau de consentement n\'est affiché :',
                ],
                list: [
                    'sessionId — session d\'authentification (strictement nécessaire, app) ;',
                    'oauth_code_verifier — sécurité de la connexion Google, expire après 10 minutes (strictement nécessaire, app) ;',
                    'theme et locale — préférences d\'interface (fonctionnels, exemptés de consentement, app) ;',
                    'nest2d_session_id — statistiques d\'usage anonymes propriétaires (mesure d\'audience exemptée, app) ;',
                    '_ga — Google Analytics 4 sur nestorcut.com uniquement, configuré selon l\'exemption CNIL : IP anonymisée, aucun signal publicitaire, aucun suivi inter-sites, conservation de 2 mois (site vitrine).',
                    'Vous pouvez supprimer ou bloquer ces cookies à tout moment dans les réglages de votre navigateur. Le blocage des cookies strictement nécessaires empêchera la connexion.',
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
                    'Vous pouvez supprimer votre compte et l\'ensemble des données associées à tout moment, en libre-service, depuis votre page Profil (section « Compte »). La suppression est immédiate et irréversible ; tout abonnement actif est alors résilié immédiatement, sans remboursement.',
                    `Pour exercer ces droits, contactez-nous à ${supportEmail}. Nous répondrons dans le délai légal (un mois en application du RGPD).`,
                    'Si vous résidez en France, vous disposez également du droit d\'introduire une réclamation auprès de la CNIL (Commission Nationale de l\'Informatique et des Libertés — www.cnil.fr).',
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
                    'Si vous êtes un consommateur résidant dans l\'Union européenne, vous bénéficiez en outre du droit de rétractation légal de 14 jours à compter de l\'achat, conformément au Code de la consommation. En commençant à utiliser le Service immédiatement, vous reconnaissez que ce droit peut être limité pour les contenus numériques fournis avec votre accord exprès.',
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
                    'Demander un remboursement ne clôt pas automatiquement votre compte. Vous pouvez supprimer votre compte et les données associées à tout moment depuis votre page Profil (section « Compte »), comme décrit dans notre Politique de confidentialité.',
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
