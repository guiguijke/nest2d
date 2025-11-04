<template>
    <div v-if="user.name" class="profile">
        <MainTitle :label="user.name" class="profile__title" />
        <div class="profile__content">
            <Avatar />
            <MainButton :theme="themeType.primary" @click="logoutHandler" label="Logout" class="profile__btn" />
        </div>
        <UserBalance class="profile__balance" />
        <BuyCredits />
        <div class="payhip-buttons" style="margin-top: 20px;">
            <h3>Choose a Credit Pack</h3>
            <button class="pack-button starter" @click="buyStarter">Starter Credit Pack - 1€</button>
            <button class="pack-button workshop" @click="buyWorkshop">Workshop Credit Pack - 5€</button>
            <button class="pack-button power" @click="buyPower">Power Credit Pack - 19.99€ + 25% bonus</button>
        </div>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants';

const router = useRouter();

definePageMeta({
    layout: "profile",
    middleware: "auth",
});

const { getters, actions } = authStore;
const { logout } = actions;
const user = computed(() => getters.user);

const logoutHandler = async () => {
    await logout();
    router.push({ path: '/' })
};
methods: {
    // Add these methods
    buyStarter() {
      window.location.href = 'https://shop.aplasma.fr/b/S3mNb';
    },
    buyWorkshop() {
      window.location.href = 'https://shop.aplasma.fr/b/8amDK';
    },
    buyPower() {
      window.location.href = 'https://shop.aplasma.fr/b/hWzEf';
    }
  }
</script>
<style lang="scss" scoped>
.profile {
    &__title {
        margin-bottom: 16px;
    }

    &__content {
        display: flex;
        align-items: center;
    }

    &__btn {
        margin-left: 24px;
    }

    &__balance {
        margin-top: 24px;
        margin-bottom: 24px;
    }
}
.payhip-buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.pack-button {
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  width: 80%;  /* Adjust for layout */
}
.starter { background-color: #4caf50; color: white; }
.workshop { background-color: #2196f3; color: white; }
.power { background-color: #f44336; color: white; }
</style>
