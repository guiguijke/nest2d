/**
 * Reads the Stripe checkout session payment status.
 * Note: useRuntimeConfig must be called inside the function — at module top
 * level there is no Nuxt context and the key would resolve to undefined.
 */
export async function getTransactionStatus(transactionId) {
    const stripeSecretKey = useRuntimeConfig().stripeSecretKey
    const response = await $fetch(`https://api.stripe.com/v1/checkout/sessions/${transactionId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    })
    return response.payment_status
}
