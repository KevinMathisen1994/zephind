import { useState } from "react";
import { useApiQuery as useQuery, useApiMutation as useMutation } from "../hooks/useApi";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Input } from "../components/ui/input";
import {
  Users,
  Plus,
  Search,
  Mail,
  Phone,
  Building,
  MapPin,
  FileText,
  Trash2,
  Edit,
  X,
  FileCheck2,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Doc, Id } from "../lib/dataModel";

export default function CustomersPage() {
  const navigate = useNavigate();
  const customers = useQuery(api.customers.list);
  const orders = useQuery(api.orders.list);
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const removeCustomer = useMutation(api.customers.remove);

  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Doc<"customers"> | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName("");
    setCompany("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
    setEditingCustomer(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEditClick = (c: Doc<"customers">) => {
    setEditingCustomer(c);
    setName(c.name || "");
    setCompany(c.company || "");
    setPhone(c.phone || "");
    setEmail(c.email || "");
    setAddress(c.address || "");
    setNotes(c.notes || "");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);

    try {
      if (editingCustomer) {
        await updateCustomer({
          id: editingCustomer._id,
          name: name.trim(),
          company: company.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        await createCustomer({
          name: name.trim(),
          company: company.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      }
      setShowModal(false);
      resetForm();
    } catch (err) {
      console.error("Failed to save customer:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: Id<"customers">) => {
    if (confirm("この顧客情報を削除してもよろしいですか？")) {
      await removeCustomer({ id });
    }
  };

  const filteredCustomers = (customers || []).filter((c) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q)
    );
  });

  const getCustomerOrdersCount = (customerId: string) => {
    return (orders || []).filter((o) => o.customerId === customerId).length;
  };

  return (
    <div className="page-shell">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="eyebrow-pill">Customer Registry</div>
          <h1 className="page-title">顧客管理</h1>
          <p className="page-subtitle">
            買主情報の登録、連絡先管理、希望物件オーダーとの紐付けが一括で行えます
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4" />
          新規顧客登録
        </Button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: Users, color: "var(--brand)", bg: "var(--brand-soft)", label: "登録顧客数", value: customers?.length, loading: customers === undefined },
          { icon: FileCheck2, color: "var(--info)", bg: "var(--info-soft)", label: "連携済みオーダー数", value: orders?.filter((o) => !!o.customerId).length, loading: orders === undefined },
          { icon: Building, color: "var(--warning)", bg: "var(--warning-soft)", label: "法人顧客数", value: customers?.filter((c) => !!c.company).length, loading: customers === undefined },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className="stat-label">{kpi.label}</span>
              <span
                className="kpi-icon"
                style={{ background: kpi.bg, color: kpi.color }}
              >
                <kpi.icon className="h-[15px] w-[15px]" />
              </span>
            </div>
            {kpi.loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="stat-value">{kpi.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Search bar ── */}
      <div className="toolbar">
        <div className="relative w-full flex-1 md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="氏名・電話・メール・会社名で検索..."
            className="field pl-9"
          />
        </div>
        <Badge variant="neutral" className="ml-auto px-2.5 py-1 font-semibold">
          該当 {filteredCustomers.length} 件
        </Badge>
      </div>

      {/* Customer List */}
      {customers === undefined ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => <Skeleton key={n} className="h-52 w-full rounded-2xl" />)}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="empty-state">
          <Users className="mx-auto mb-3 h-8 w-8 text-[var(--text-placeholder)]" />
          <p className="text-sm font-semibold text-[var(--text-secondary)]">登録されている顧客がありません</p>
          <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">「新規顧客登録」から顧客情報を追加してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map((c) => {
            const orderCount = getCustomerOrdersCount(c._id);
            return (
              <div
                key={c._id}
                className="flex h-full flex-col justify-between space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-white p-5 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-[var(--border-default)] hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-ink)]">
                      {c.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-[17.5px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">{c.name}</h3>
                      {c.company ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] truncate mt-0.5">
                          <Building className="w-3 h-3 text-[var(--text-muted)]" />
                          {c.company}
                        </div>
                      ) : (
                        <span className="text-[14px] text-[var(--text-muted)] font-medium">個人</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleEditClick(c)} title="編集" className="h-8 w-8 rounded-xl">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(c._id)} title="削除" className="h-8 w-8 rounded-xl hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 text-xs font-medium text-[var(--text-secondary)] flex-1">
                  {c.phone && (
                    <div className="flex items-center gap-2.5">
                      <Phone className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                      <a href={`tel:${c.phone}`} className="hover:underline font-bold text-[var(--text-primary)] font-data">{c.phone}</a>
                    </div>
                  )}
                  {c.email && (
                    <div className="flex items-center gap-2.5">
                      <Mail className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                      <a href={`mailto:${c.email}`} className="hover:underline font-semibold text-[var(--text-primary)] truncate">{c.email}</a>
                    </div>
                  )}
                  {c.address && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                      <span className="truncate">{c.address}</span>
                    </div>
                  )}
                  {c.notes && (
                    <div className="p-3 rounded-xl bg-[var(--bg-page-subtle)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-xs leading-relaxed mt-2">
                      <FileText className="w-3 h-3 text-[var(--brand)] inline mr-1.5" />
                      {c.notes}
                    </div>
                  )}
                </div>

                <div className="pt-3 flex items-center justify-between border-t border-[var(--border-subtle)]">
                  <Badge variant="brand" className="font-bold">オーダー {orderCount} 件</Badge>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/orders")} className="text-xs text-[var(--brand)] font-bold hover:bg-[var(--brand-soft)]">
                    オーダー確認
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-ambient border border-[var(--border-subtle)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-page-subtle)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[var(--brand-soft)] text-[var(--brand)] flex items-center justify-center border border-[var(--brand-border)]">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-base font-extrabold text-[var(--text-primary)]">
                  {editingCustomer ? "顧客情報の編集" : "新規顧客登録"}
                </h3>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowModal(false)} className="h-8 w-8 rounded-xl">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                  氏名 <span className="text-red-500">*</span>
                </label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 山田 太郎" className="rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">会社名・屋号</label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="例: 株式会社ABCインベストメント" className="rounded-xl" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">電話番号</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="例: 090-1234-5678"
                    className="w-full px-3.5 py-2.5 bg-[var(--bg-page-subtle)] border border-[var(--border-default)] rounded-xl text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus-brand transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">メールアドレス</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="例: yamada@example.com"
                    className="w-full px-3.5 py-2.5 bg-[var(--bg-page-subtle)] border border-[var(--border-default)] rounded-xl text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus-brand transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">所在地・住所</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="例: 東京都港区六本木1-2-3"
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-page-subtle)] border border-[var(--border-default)] rounded-xl text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus-brand transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">メモ・希望条件の補足</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="例: 都心一戸建て・利回り5%以上を希望。連絡は平日午後が希望。"
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-page-subtle)] border border-[var(--border-default)] rounded-xl text-sm font-medium text-[var(--text-primary)] focus:outline-none focus-brand transition-all"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-5 border-t border-[var(--border-subtle)]">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowModal(false)}>キャンセル</Button>
                <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
                  {submitting ? "保存中..." : editingCustomer ? "更新する" : "登録する"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}