<template>
    <footer class="footer"> 
        <div class="footer__content content">
            <img src="/brand/logo-dark-stacked.png" alt="NestorCut" class="footer__logo" />
            <ul class="list">
                <li class="list__item">
                    <a
                        href="https://github.com/guiguijke/nestorcut"
                        target="_blank"
                        class="list__link"
                    >
                        GitHub
                    </a>
                </li>
                <li class="list__item" v-if="discordUrl">
                    <a
                        :href="discordUrl"
                        target="_blank"
                        rel="noopener"
                        class="list__link"
                    >
                        Discord
                    </a>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/legal-notice"
                        class="list__link"
                    >
                        Legal Notice
                    </NuxtLink>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/terms-and-conditions"
                        class="list__link"
                    >
                        Terms
                    </NuxtLink>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/privacy"
                        class="list__link"
                    >
                        Privacy
                    </NuxtLink>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/refund"
                        class="list__link"
                    >
                        Refund Policy
                    </NuxtLink>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/licences"
                        class="list__link"
                    >
                        Licences
                    </NuxtLink>
                </li>
                <li class="list__item">
                    <NuxtLink
                        to="/changelog"
                        class="list__link"
                    >
                        Changelog
                    </NuxtLink>
                </li>
            </ul>
            <div class="footer__meta">
                <p class="footer__copyright">
                    © {{ copyrightYear }} NestorCut by APlasma.
                </p>
                <p class="footer__note">
                    NestorCut is under very active development — a bug you hit today may already be fixed tomorrow.
                </p>
            </div>
        </div>
    </footer>
</template>

<script setup>
import { useSiteConfig } from '~~/data/siteConfig';

const { copyrightYear, discordUrl } = useSiteConfig();
</script>

<style lang="scss" scoped>
.footer {
    padding: 12px 8px;
    background-color: var(--footer-bg);

    &__logo {
        height: 64px;
        width: auto;
        border-radius: 4px;
        margin-bottom: 12px;

        @media (min-width: 1199px) {
            margin-bottom: 0;
            margin-right: 24px;
        }
    }

    @media (min-width: 567px) {
        padding: 16px 10px;
    }
    &__content {
        max-width: 1300px;
        margin-right: auto;
        margin-left: auto;
    }
    &__meta {
        margin-top: 16px;

        @media (min-width: 1199px) {
            margin-top: initial;
        }
    }
    &__copyright {
        text-align: center;
        color: var(--main-white);
        display: block;
        font-weight: 600;
        opacity: 0.7;

        @media (min-width: 1199px) {
            text-align: initial;
        }
    }
    &__note {
        text-align: center;
        color: var(--main-white);
        display: block;
        font-size: 0.8rem;
        opacity: 0.45;
        margin-top: 4px;

        @media (min-width: 1199px) {
            text-align: initial;
        }
    }
}
.content {
    @media (min-width: 567px) {
        padding-right: 10px;
        padding-left: 10px;
    }
    @media (min-width: 1199px) {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
}
.list {
    display: flex;
    flex-wrap: wrap;
    @media (min-width: 567px) {
    }
    &__item {
        margin: 8px;

        @media (min-width: 567px) {
            margin: initial;
        }
        &:not(:last-child) {
            @media (min-width: 567px) {
                margin-right: 40px;
                margin-bottom: initial;
            }
        }
    }
    &__link {
        text-align: center;
        color: var(--main-white);
        display: block;
        font-weight: 600;
        transition: opacity 0.3s;
        opacity: 0.7;

        @media (min-width: 567px) {
            text-align: initial;
        }

        @media (hover:hover) {
            &:hover {
                opacity: 1;
            }
        }
    }
}

</style>
