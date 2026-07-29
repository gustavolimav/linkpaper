import { z } from "zod";
import { ValidationError } from "./errors";

export const userCreateSchema = z.object({
  username: z
    .string()
    .min(3, "O 'username' deve ter no mínimo 3 caracteres.")
    .max(30, "O 'username' deve ter no máximo 30 caracteres.")
    .regex(
      /^[a-zA-Z0-9]+$/,
      "O 'username' deve conter apenas letras e números.",
    ),
  email: z
    .string()
    .email("O 'email' informado não é válido.")
    .max(254, "O 'email' deve ter no máximo 254 caracteres."),
  password: z.string().min(8, "A 'password' deve ter no mínimo 8 caracteres."),
});

export const userUpdateSchema = z
  .object({
    username: z
      .string()
      .min(3, "O 'username' deve ter no mínimo 3 caracteres.")
      .max(30, "O 'username' deve ter no máximo 30 caracteres.")
      .regex(
        /^[a-zA-Z0-9]+$/,
        "O 'username' deve conter apenas letras e números.",
      )
      .optional(),
    email: z
      .string()
      .email("O 'email' informado não é válido.")
      .max(254, "O 'email' deve ter no máximo 254 caracteres.")
      .optional(),
    password: z
      .string()
      .min(8, "A 'password' deve ter no mínimo 8 caracteres.")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser fornecido para atualização.",
  });

export const authenticationSchema = z.object({
  email: z.string().email("O 'email' informado não é válido."),
  password: z.string().min(1, "O campo 'password' é obrigatório."),
});

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const MAX_FILE_SIZE_BYTES =
  Number(process.env.MAX_FILE_SIZE_MB ?? 50) * 1024 * 1024;

export const documentCreateSchema = z.object({
  title: z
    .string()
    .min(1, "O 'title' é obrigatório.")
    .max(255, "O 'title' deve ter no máximo 255 caracteres."),
  description: z
    .string()
    .max(1000, "A 'description' deve ter no máximo 1000 caracteres.")
    .optional(),
});

export const documentUpdateSchema = z
  .object({
    title: z
      .string()
      .min(1, "O 'title' não pode ser vazio.")
      .max(255, "O 'title' deve ter no máximo 255 caracteres.")
      .optional(),
    description: z
      .string()
      .max(1000, "A 'description' deve ter no máximo 1000 caracteres.")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser fornecido para atualização.",
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(100).optional().default(10),
});

function isFutureDate(value: string): boolean {
  return new Date(value) > new Date();
}

const allowedEmailsSchema = z
  .array(z.string().email("Um dos 'allowed_emails' informados não é válido."))
  .max(100, "O 'allowed_emails' excede o número máximo de 100 endereços.");

const ndaTextSchema = z
  .string()
  .max(10000, "O 'nda_text' deve ter no máximo 10000 caracteres.");

const brandAccentColorSchema = z
  .string()
  .regex(
    /^#[0-9A-Fa-f]{6}$/,
    "A 'brand_accent_color' deve ser uma cor hexadecimal no formato #RRGGBB.",
  );

const brandWelcomeMessageSchema = z
  .string()
  .max(500, "A 'brand_welcome_message' deve ter no máximo 500 caracteres.");

export const shareLinkCreateSchema = z.object({
  label: z
    .string()
    .max(255, "O 'label' deve ter no máximo 255 caracteres.")
    .optional(),
  password: z
    .string()
    .min(4, "A 'password' deve ter no mínimo 4 caracteres.")
    .optional(),
  expires_at: z
    .string()
    .datetime("A 'expires_at' deve ser uma data ISO válida.")
    .refine(isFutureDate, {
      message: "A data de expiração deve ser futura.",
    })
    .optional(),
  allow_download: z.boolean().optional(),
  notify_on_view: z.boolean().optional(),
  require_email: z.boolean().optional(),
  allowed_emails: allowedEmailsSchema.optional(),
  watermark_enabled: z.boolean().optional(),
  nda_text: ndaTextSchema.optional(),
  brand_accent_color: brandAccentColorSchema.optional(),
  brand_welcome_message: brandWelcomeMessageSchema.optional(),
});

export const shareLinkUpdateSchema = z
  .object({
    label: z
      .string()
      .max(255, "O 'label' deve ter no máximo 255 caracteres.")
      .nullable()
      .optional(),
    password: z
      .string()
      .min(4, "A 'password' deve ter no mínimo 4 caracteres.")
      .nullable()
      .optional(),
    expires_at: z
      .string()
      .datetime("A 'expires_at' deve ser uma data ISO válida.")
      .refine(isFutureDate, {
        message: "A data de expiração deve ser futura.",
      })
      .nullable()
      .optional(),
    allow_download: z.boolean().optional(),
    is_active: z.boolean().optional(),
    notify_on_view: z.boolean().optional(),
    require_email: z.boolean().optional(),
    allowed_emails: allowedEmailsSchema.nullable().optional(),
    watermark_enabled: z.boolean().optional(),
    nda_text: ndaTextSchema.nullable().optional(),
    brand_accent_color: brandAccentColorSchema.nullable().optional(),
    brand_welcome_message: brandWelcomeMessageSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser fornecido para atualização.",
  });

export const dataRoomCreateSchema = z.object({
  name: z
    .string()
    .min(1, "O 'name' é obrigatório.")
    .max(255, "O 'name' deve ter no máximo 255 caracteres."),
  document_ids: z
    .array(z.string().uuid("Um dos 'document_ids' informados não é válido."))
    .min(1, "Pelo menos um documento deve ser informado."),
});

export const dataRoomUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1, "O 'name' é obrigatório.")
      .max(255, "O 'name' deve ter no máximo 255 caracteres.")
      .optional(),
    documents: z
      .array(
        z.object({
          document_id: z
            .string()
            .uuid("Um dos 'document_id' informados não é válido."),
          allow_download: z.boolean(),
        }),
      )
      .min(1, "Pelo menos um documento deve ser informado.")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser fornecido para atualização.",
  });

export const dataRoomLinkCreateSchema = z.object({
  label: z
    .string()
    .max(255, "O 'label' deve ter no máximo 255 caracteres.")
    .optional(),
  password: z
    .string()
    .min(4, "A 'password' deve ter no mínimo 4 caracteres.")
    .optional(),
  expires_at: z
    .string()
    .datetime("A 'expires_at' deve ser uma data ISO válida.")
    .refine(isFutureDate, {
      message: "A data de expiração deve ser futura.",
    })
    .optional(),
  require_email: z.boolean().optional(),
  allowed_emails: allowedEmailsSchema.optional(),
  notify_on_view: z.boolean().optional(),
  watermark_enabled: z.boolean().optional(),
  nda_text: ndaTextSchema.optional(),
  brand_accent_color: brandAccentColorSchema.optional(),
  brand_welcome_message: brandWelcomeMessageSchema.optional(),
});

export const dataRoomLinkUpdateSchema = z
  .object({
    label: z
      .string()
      .max(255, "O 'label' deve ter no máximo 255 caracteres.")
      .nullable()
      .optional(),
    password: z
      .string()
      .min(4, "A 'password' deve ter no mínimo 4 caracteres.")
      .nullable()
      .optional(),
    expires_at: z
      .string()
      .datetime("A 'expires_at' deve ser uma data ISO válida.")
      .refine(isFutureDate, {
        message: "A data de expiração deve ser futura.",
      })
      .nullable()
      .optional(),
    is_active: z.boolean().optional(),
    require_email: z.boolean().optional(),
    allowed_emails: allowedEmailsSchema.nullable().optional(),
    notify_on_view: z.boolean().optional(),
    watermark_enabled: z.boolean().optional(),
    nda_text: ndaTextSchema.nullable().optional(),
    brand_accent_color: brandAccentColorSchema.nullable().optional(),
    brand_welcome_message: brandWelcomeMessageSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Pelo menos um campo deve ser fornecido para atualização.",
  });

export const dataRoomLinkViewCreateSchema = z.object({
  document_id: z.string().uuid("O 'document_id' informado não é válido."),
  viewer_fingerprint: z
    .string()
    .max(64, "O 'viewer_fingerprint' deve ter no máximo 64 caracteres.")
    .optional(),
  viewer_email: z
    .string()
    .email("O 'viewer_email' informado não é válido.")
    .max(254, "O 'viewer_email' deve ter no máximo 254 caracteres.")
    .optional(),
  viewer_name: z
    .string()
    .max(255, "O 'viewer_name' deve ter no máximo 255 caracteres.")
    .optional(),
  time_on_page: z
    .number()
    .int()
    .min(0, "O 'time_on_page' não pode ser negativo.")
    .optional(),
  pages_viewed: z
    .number()
    .int()
    .min(0, "O 'pages_viewed' não pode ser negativo.")
    .optional(),
  downloaded: z.boolean().optional(),
});

export const workspaceCreateSchema = z.object({
  name: z
    .string()
    .min(1, "O 'name' é obrigatório.")
    .max(120, "O 'name' deve ter no máximo 120 caracteres."),
});

export const workspaceUpdateSchema = workspaceCreateSchema;

export const workspaceMemberInviteSchema = z.object({
  email: z.string().email("O 'email' informado não é válido."),
  // Can't directly invite as owner — role changes to owner go through
  // PATCH .../members/[userId] instead.
  role: z.enum(["editor", "viewer"], {
    message: "O 'role' deve ser 'editor' ou 'viewer'.",
  }),
});

export const workspaceMemberRoleUpdateSchema = z.object({
  role: z.enum(["owner", "editor", "viewer"], {
    message: "O 'role' deve ser 'owner', 'editor' ou 'viewer'.",
  }),
});

export const billingCheckoutSchema = z.object({
  plan: z.enum(["pro", "business"], {
    message: "O 'plan' deve ser 'pro' ou 'business'.",
  }),
});

export const featureFlagUpdateSchema = z.object({
  enabled: z.boolean({ message: "O 'enabled' deve ser um booleano." }),
});

export const linkViewCreateSchema = z.object({
  viewer_fingerprint: z
    .string()
    .max(64, "O 'viewer_fingerprint' deve ter no máximo 64 caracteres.")
    .optional(),
  viewer_email: z
    .string()
    .email("O 'viewer_email' informado não é válido.")
    .max(254, "O 'viewer_email' deve ter no máximo 254 caracteres.")
    .optional(),
  viewer_name: z
    .string()
    .max(255, "O 'viewer_name' deve ter no máximo 255 caracteres.")
    .optional(),
  time_on_page: z
    .number()
    .int()
    .min(0, "O 'time_on_page' não pode ser negativo.")
    .optional(),
  pages_viewed: z
    .number()
    .int()
    .min(0, "O 'pages_viewed' não pode ser negativo.")
    .optional(),
  page_times: z
    .array(
      z.object({
        page: z.number().int().positive("A 'page' deve ser positiva."),
        seconds: z.number().min(0, "O 'seconds' não pode ser negativo."),
      }),
    )
    .max(2000, "O 'page_times' excede o número máximo de páginas permitido.")
    .optional(),
  downloaded: z.boolean().optional(),
});

export const followupEmailCreateSchema = z.object({
  viewer_fingerprint: z
    .string()
    .min(1, "O 'viewer_fingerprint' é obrigatório.")
    .max(64, "O 'viewer_fingerprint' deve ter no máximo 64 caracteres."),
});

export const chatCreateSchema = z.object({
  question: z
    .string()
    .min(1, "A 'question' é obrigatória.")
    .max(2000, "A 'question' deve ter no máximo 2000 caracteres."),
});

export const aiKeyUpdateSchema = z.object({
  api_key: z
    .string()
    .min(20, "A chave informada parece inválida.")
    .max(200, "A chave informada é muito longa."),
});

export const passwordResetRequestSchema = z.object({
  email: z
    .string()
    .email("O 'email' informado não é válido.")
    .max(254, "O 'email' deve ter no máximo 254 caracteres."),
});

export const passwordResetSchema = z.object({
  password: z.string().min(8, "A 'password' deve ter no mínimo 8 caracteres."),
});

// Used outside request-body validation (e.g. the X-Viewer-Email header on
// the public share endpoints), where there's no Zod object schema to run.
export function isValidEmail(value: string): boolean {
  return z.string().email().safeParse(value).success;
}

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const firstError = result.error.issues[0];
    throw new ValidationError({
      message: firstError?.message ?? "Dados inválidos.",
      action: "Corrija os dados enviados e tente novamente.",
    });
  }

  return result.data;
}
