<script setup lang="ts">
/**
 * The window of a new project: a title, a line about it, and the folder of its repository if it has one.
 * Окно нового проекта: название, строка о нём и папка репозитория, если он есть.
 */
import { TaoButton, TaoFlex, TaoFormField, TaoInput, TaoModal, TaoTextarea, toast } from '@1337exp/taoui';
import { ref, watch } from 'vue';
import { createProject } from '@/app/state';
import { useI18n } from '@/i18n';

const open = defineModel<boolean>({ required: true });
const { t } = useI18n();

const title = ref('');
const description = ref('');
const repo = ref('');
const busy = ref(false);

watch(open, (now) => {
    if (now) {
        title.value = '';
        description.value = '';
        repo.value = '';
    }
});

async function submit(): Promise<void> {
    if (title.value.trim() === '' || busy.value) return;
    busy.value = true;
    try {
        await createProject({ title: title.value, description: description.value, repo: repo.value });
        open.value = false;
    } catch (error) {
        toast().danger().message(error instanceof Error ? error.message : String(error));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <TaoModal v-model="open" :title="t('project.createTitle')">
        <form class="new-project" @submit.prevent="submit">
            <TaoFormField :label="t('project.title')" :hint="t('project.titleHint')">
                <TaoInput v-model="title" autofocus autocomplete="off" />
            </TaoFormField>
            <TaoFormField :label="t('project.description')" :hint="t('project.descriptionHint')">
                <TaoTextarea v-model="description" variant="outline" :rows="2" />
            </TaoFormField>
            <TaoFormField :label="t('project.repo')" :hint="t('project.repoHint')">
                <TaoInput v-model="repo" autocomplete="off" />
            </TaoFormField>
            <TaoFlex justify="flex-end" :gap="8">
                <TaoButton variant="secondary" @click="open = false">{{ t('project.cancel') }}</TaoButton>
                <TaoButton type="submit" :disabled="title.trim() === ''" :loading="busy">{{ t('project.submit') }}</TaoButton>
            </TaoFlex>
        </form>
    </TaoModal>
</template>

<style scoped>
.new-project {
    display: grid;
    gap: var(--tao-space-4);
    min-width: min(440px, 80vw);
}
</style>
