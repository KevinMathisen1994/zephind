import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
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

export default function CustomersPage() {
  const navigate = useNavigate();
  const customers = useQuery(api.customers.list);
  const orders = useQuery(api.orders.list);
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);
  const removeCustomer = useMutation(api.customers.remove);

  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);

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

  const handleEditClick = (c: any) => {
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
          id: editingCustomer._id as any,
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

  const handleDelete = async (id: string) => {
    if (confirm("この顧客情報を削除してもよろしいですか？")) {
      await removeCustomer({ id: id as any });
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
    return (orders || []).filter((o) => (o as any).customerId === customerId)
      .length;
  };

  return (
    <div className="p-6 md:p-10 space-y-8 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 md:p-8 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs tracking-wider uppercase mb-1">
            <Users className="w-4 h-4 text-emerald-600" />
            顧客データベース
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            顧客管理 (買主・クライアント)
          </h1>
          <p className="text-base text-slate-500 mt-1 leading-relaxed">
            買主クライアント情報の登録、連絡先管理、希望物件オーダーとの紐付けが一括で行えます
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="h-12 px-6 text-base font-semibold gap-2 shadow-lg shadow-emerald-700/20 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl transition-all duration-200 shrink-0"
        >
          <Plus className="w-5 h-5" />
          新規顧客登録
        </Button>
      </div>

      {/* KPI Overview Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-700 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-400">
              登録顧客数
            </div>
            <div className="text-2xl font-black text-slate-900 font-data tracking-tight">
              {customers === undefined ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                customers.length
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
            <FileCheck2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-400">
              連携済みオーダー数
            </div>
            <div className="text-2xl font-black text-slate-900 font-data tracking-tight">
              {orders === undefined ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                orders.filter((o) => !!(o as any).customerId).length
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-slate-100 text-slate-700 shrink-0">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-400">
              法人顧客数
            </div>
            <div className="text-2xl font-black text-slate-900 font-data tracking-tight">
              {customers === undefined ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                customers.filter((c) => !!c.company).length
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="氏名・電話・メール・会社名で検索..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 transition-all"
          />
        </div>
        <div className="text-xs font-bold text-slate-400">
          該当: {filteredCustomers.length} 件
        </div>
      </div>

      {/* Customer List */}
      {customers === undefined ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <Card className="border border-slate-200/80 rounded-2xl bg-white">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-base font-bold text-slate-700">
              登録されている顧客がありません
            </p>
            <p className="text-sm text-slate-400 mt-1">
              「新規顧客登録」から顧客情報を追加してください。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredCustomers.map((c) => {
            const orderCount = getCustomerOrdersCount(c._id);
            return (
              <Card
                key={c._id}
                className="bg-white border border-slate-200/80 shadow-sm rounded-2xl overflow-hidden hover:border-slate-300 transition-all duration-200 flex flex-col justify-between"
              >
                <CardHeader className="p-5 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-900 font-extrabold flex items-center justify-center text-base border border-emerald-200 shrink-0">
                        {c.name.slice(0, 1)}
                      </div>
                      <div>
                        <CardTitle className="text-lg font-extrabold text-slate-900 tracking-tight">
                          {c.name}
                        </CardTitle>
                        {c.company && (
                          <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 mt-0.5">
                            <Building className="w-3 h-3 text-slate-400" />
                            {c.company}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleEditClick(c)}
                        className="p-2 text-slate-400 hover:text-emerald-700 transition-colors rounded-lg hover:bg-slate-100"
                        title="編集"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c._id)}
                        className="p-2 text-slate-400 hover:text-red-600 transition-colors rounded-lg hover:bg-slate-100"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-5 space-y-3 text-xs font-medium text-slate-600 flex-1">
                  {c.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <a
                        href={`tel:${c.phone}`}
                        className="hover:underline font-bold text-slate-900"
                      >
                        {c.phone}
                      </a>
                    </div>
                  )}

                  {c.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <a
                        href={`mailto:${c.email}`}
                        className="hover:underline font-semibold text-slate-800 truncate"
                      >
                        {c.email}
                      </a>
                    </div>
                  )}

                  {c.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{c.address}</span>
                    </div>
                  )}

                  {c.notes && (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-slate-700 text-xs mt-2 leading-relaxed">
                      <FileText className="w-3 h-3 text-slate-400 inline mr-1" />
                      {c.notes}
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between border-t border-slate-100 mt-3">
                    <Badge className="bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs font-bold px-2.5 py-0.5">
                      連携オーダー: {orderCount}件
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("/orders")}
                      className="text-xs font-bold text-emerald-800 hover:bg-emerald-50 h-7 px-2"
                    >
                      オーダー管理
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-700" />
                {editingCustomer ? "顧客情報の編集" : "新規顧客登録"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  氏名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: 山田 太郎"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  会社名・屋号
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="例: 株式会社ABCインベストメント"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    電話番号
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="例: 090-1234-5678"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="例: yamada@example.com"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  所在地・住所
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="例: 東京都港区六本木1-2-3"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  メモ・要望
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="例: 都心一戸建て・利回り5%以上を希望。連絡は平日午後が希望。"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border-slate-200 text-xs font-bold"
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold px-5"
                >
                  {submitting
                    ? "保存中..."
                    : editingCustomer
                      ? "更新する"
                      : "登録する"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
