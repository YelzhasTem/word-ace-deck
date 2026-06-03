import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, FolderOpen, Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useCollections } from "@/lib/collections";
import { useDecks } from "@/lib/decks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/collections")({
  component: CollectionsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Ошибка: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Не найдено</div>,
});

function CollectionsPage() {
  const { collections, createCollection, deleteCollection, setCollectionDecks } =
    useCollections();
  const { decks } = useDecks();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  const openPicker = (collectionId: string, current: string[]) => {
    setPickerFor(collectionId);
    setPickerSelected(new Set(current));
  };

  const toggleDeck = (deckId: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      return next;
    });
  };

  const savePicker = () => {
    if (!pickerFor) return;
    setCollectionDecks(pickerFor, Array.from(pickerSelected));
    setPickerFor(null);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    createCollection(name.trim(), description.trim());
    setName("");
    setDescription("");
    setCreateOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Коллекции</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Группируйте свои колоды в тематические коллекции
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Новая коллекция
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Создать коллекцию</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Название"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Textarea
                  placeholder="Описание (необязательно)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={!name.trim()}>
                  Создать
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {collections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">У вас пока нет коллекций</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((c) => {
              const collectionDecks = decks.filter((d) => c.deckIds.includes(d.id));
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{c.name}</h3>
                      {c.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteCollection(c.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {collectionDecks.length} колод
                  </div>

                  {collectionDecks.length > 0 && (
                    <ul className="space-y-1">
                      {collectionDecks.slice(0, 4).map((d) => (
                        <li key={d.id} className="text-sm">
                          <Link
                            to="/deck/$deckId"
                            params={{ deckId: d.id }}
                            className="hover:text-primary transition-colors truncate block"
                          >
                            · {d.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-auto"
                    onClick={() => openPicker(c.id, c.deckIds)}
                  >
                    Выбрать колоды
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={pickerFor !== null} onOpenChange={(o) => !o && setPickerFor(null)}>
          <DialogContent className="max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Выберите колоды</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-1 py-2">
              {decks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Сначала создайте колоды
                </p>
              ) : (
                decks.map((d) => {
                  const checked = pickerSelected.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDeck(d.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.cards.length} карточек
                        </div>
                      </div>
                      {checked && <Check className="h-4 w-4 text-primary" />}
                    </label>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPickerFor(null)}>
                Отмена
              </Button>
              <Button onClick={savePicker}>Сохранить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
