<script setup lang="ts">
import { ref } from 'vue'
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { Input } from '@/components/ui/input'

defineProps<{
  id: string
  placeholder?: string
  autocomplete?: string
  invalid?: boolean
  describedBy?: string
}>()

const model = defineModel<string>({ required: true })

const visible = ref(false)
</script>

<template>
  <div class="relative">
    <Input
      :id="id"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :aria-invalid="invalid || undefined"
      :aria-describedby="describedBy"
      class="h-9 px-3 pr-10 text-sm"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      :aria-label="visible ? 'Hide password' : 'Show password'"
      @click="visible = !visible"
    >
      <EyeOffIcon v-if="visible" class="size-4" />
      <EyeIcon v-else class="size-4" />
    </button>
  </div>
</template>
