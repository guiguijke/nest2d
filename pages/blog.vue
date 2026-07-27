<template>
    <div class="space-y-8">
        <BlogEntry
            v-for="(post, postIndex) in posts"
            :key="postIndex"
            :post="post"
        />
    </div>
</template>

<script setup>
import { usePosts } from "~~/data/blog";

const posts = usePosts();

definePageMeta({
    layout: "doc",
});
</script>
