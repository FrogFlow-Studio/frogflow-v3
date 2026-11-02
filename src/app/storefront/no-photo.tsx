/**
 * Товар без фото: одна заглушка на всю витрину — цвет магазина и первая буква названия,
 * вместо пустого серого поля или случайного эмодзи.
 */
export function NoPhoto({ name, className = "" }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "•";
  return (
    <div
      aria-hidden
      data-testid="no-photo"
      className={`flex items-center justify-center bg-accent/10 font-semibold text-accent ${className}`}
    >
      <span className="text-4xl">{letter}</span>
    </div>
  );
}
