"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import type { User } from "@supabase/supabase-js"
import Image from "next/image"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { hasSupabaseEnv, supabase } from "@/lib/supabase"

type BookingRow = {
  id: string
  booking_date: string
  hour: number
  booked_by: string
  profiles:
    | {
        full_name: string | null
        email: string | null
      }
    | {
        full_name: string | null
        email: string | null
      }[]
    | null
}

type Notice = {
  kind: "error" | "success"
  text: string
}

type AuthStep = "email" | "login" | "signup"

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8)
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const SESSION_STARTED_AT_KEY = "digizag_meeting_room_session_started_at"
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const HR_EMAIL = "hr@digizag.com"

function formatDateKey(value: Date) {
  return format(value, "yyyy-MM-dd")
}

function getDisplayName(
  profile: { full_name: string | null; email: string | null } | null,
  fallbackEmail?: string | null
) {
  const fullName = profile?.full_name?.trim()
  if (fullName) {
    return fullName
  }

  const email = profile?.email ?? fallbackEmail ?? ""
  const handle = email.split("@")[0]
  if (!handle) {
    return "Unknown"
  }

  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function resolveProfile(value: BookingRow["profiles"]) {
  if (!value) {
    return null
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
}

function toHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

function initialNameFromEmail(email?: string | null) {
  if (!email) {
    return "Employee"
  }

  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function isValidEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email)
}

export default function Home() {
  const [ready, setReady] = useState(!hasSupabaseEnv)
  const [user, setUser] = useState<User | null>(null)
  const [authStep, setAuthStep] = useState<AuthStep>("email")
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("")
  const [showAuthPassword, setShowAuthPassword] = useState(false)
  const [showAuthPasswordConfirm, setShowAuthPasswordConfirm] = useState(false)
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [submittingAuth, setSubmittingAuth] = useState(false)

  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)

  const [selectedHours, setSelectedHours] = useState<number[]>([])
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const normalizedEmail = authEmail.trim().toLowerCase()

  const markSessionStarted = useCallback(() => {
    localStorage.setItem(SESSION_STARTED_AT_KEY, String(Date.now()))
  }, [])

  const clearSessionStarted = useCallback(() => {
    localStorage.removeItem(SESSION_STARTED_AT_KEY)
  }, [])

  const hasSessionExpired = useCallback(() => {
    const stored = localStorage.getItem(SESSION_STARTED_AT_KEY)
    if (!stored) {
      return false
    }

    const startedAt = Number(stored)
    if (!Number.isFinite(startedAt)) {
      return false
    }

    return Date.now() - startedAt > SESSION_TTL_MS
  }, [])

  const ensureProfile = useCallback(async (authUser: User) => {
    if (!authUser.email) {
      return
    }

    await supabase.from("profiles").upsert(
      {
        id: authUser.id,
        email: authUser.email,
        full_name: initialNameFromEmail(authUser.email),
      },
      { onConflict: "id" }
    )
  }, [])

  const loadMonthBookings = useCallback(async (monthDate: Date) => {
    setLoadingBookings(true)

    const from = format(startOfMonth(monthDate), "yyyy-MM-dd")
    const to = format(endOfMonth(monthDate), "yyyy-MM-dd")

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_date, hour, booked_by, profiles:profiles!bookings_booked_by_fkey(full_name, email)"
      )
      .gte("booking_date", from)
      .lte("booking_date", to)
      .order("booking_date", { ascending: true })
      .order("hour", { ascending: true })

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setBookings((data ?? []) as unknown as BookingRow[])
      setNotice(null)
    }

    setLoadingBookings(false)
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      return
    }

    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) {
        return
      }

      const sessionUser = data.session?.user ?? null
      if (sessionUser && hasSessionExpired()) {
        clearSessionStarted()
        await supabase.auth.signOut()
        setUser(null)
        setNotice({ kind: "error", text: "Session expired. Please login again." })
        setReady(true)
        return
      }

      if (sessionUser) {
        const stored = localStorage.getItem(SESSION_STARTED_AT_KEY)
        if (!stored) {
          markSessionStarted()
        }
      }

      setUser(sessionUser)
      setReady(true)

      if (sessionUser) {
        await ensureProfile(sessionUser)
        await loadMonthBookings(currentMonth)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const sessionUser = session?.user ?? null

      if (event === "SIGNED_OUT") {
        clearSessionStarted()
      }

      if (event === "SIGNED_IN") {
        markSessionStarted()
      }

      if (sessionUser && hasSessionExpired()) {
        clearSessionStarted()
        await supabase.auth.signOut()
        setUser(null)
        setNotice({ kind: "error", text: "Session expired. Please login again." })
        return
      }

      setUser(sessionUser)
      setSelectedHours([])

      if (sessionUser) {
        await ensureProfile(sessionUser)
        await loadMonthBookings(currentMonth)
      } else {
        setBookings([])
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [
    clearSessionStarted,
    currentMonth,
    ensureProfile,
    hasSessionExpired,
    loadMonthBookings,
    markSessionStarted,
  ])

  useEffect(() => {
    if (!user) {
      return
    }

    void loadMonthBookings(currentMonth)
  }, [currentMonth, loadMonthBookings, user])

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, { count: number; names: string[] }>()

    for (const booking of bookings) {
      const key = booking.booking_date
      const current = map.get(key)
      const name = getDisplayName(resolveProfile(booking.profiles))

      if (!current) {
        map.set(key, { count: 1, names: [name] })
      } else {
        current.count += 1
        if (!current.names.includes(name)) {
          current.names.push(name)
        }
      }
    }

    return map
  }, [bookings])

  const selectedDateKey = formatDateKey(selectedDate)

  const selectedDateBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.booking_date === selectedDateKey)
        .sort((a, b) => a.hour - b.hour),
    [bookings, selectedDateKey]
  )

  const takenHours = useMemo(
    () => new Set(selectedDateBookings.map((booking) => booking.hour)),
    [selectedDateBookings]
  )

  const isSelectedDateInPast = isBefore(startOfDay(selectedDate), startOfDay(new Date()))

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)

    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 0 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
    })
  }, [currentMonth])

  const currentUserName = initialNameFromEmail(user?.email)
  const isHrUser = user?.email?.toLowerCase() === HR_EMAIL

  const handleEmailStepSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isValidEmail(normalizedEmail)) {
      setNotice({ kind: "error", text: "Enter a valid email address." })
      return
    }

    setCheckingEmail(true)

    const { data, error } = await supabase.rpc("account_exists", {
      input_email: normalizedEmail,
    })

    if (error) {
      setNotice({
        kind: "error",
        text:
          "Could not check email. Run the latest SQL script (account_exists function), then try again.",
      })
      setCheckingEmail(false)
      return
    }

    if (data) {
      setAuthStep("login")
      setNotice(null)
    } else {
      setAuthStep("signup")
      setNotice({ kind: "success", text: "New email detected. Create your password." })
    }

    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setCheckingEmail(false)
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isValidEmail(normalizedEmail)) {
      setNotice({ kind: "error", text: "Enter a valid email address." })
      return
    }

    if (!authPassword) {
      setNotice({ kind: "error", text: "Enter your password." })
      return
    }

    if (authStep === "signup") {
      if (authPassword.length < 6) {
        setNotice({ kind: "error", text: "Password must be at least 6 characters." })
        return
      }

      if (authPassword !== authPasswordConfirm) {
        setNotice({ kind: "error", text: "Passwords do not match." })
        return
      }
    }

    setSubmittingAuth(true)

    if (authStep === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: authPassword,
      })

      if (error) {
        setNotice({ kind: "error", text: "Invalid email or password." })
      } else {
        setNotice(null)
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: authPassword,
      })

      if (error) {
        setNotice({ kind: "error", text: error.message })
      } else if (!data.session) {
        setAuthStep("login")
        setNotice({
          kind: "success",
          text: "Account created. Please login with your password.",
        })
      } else {
        setNotice({ kind: "success", text: "Account created and logged in." })
      }
    }

    setSubmittingAuth(false)
  }

  const handleBackToEmail = () => {
    setAuthStep("email")
    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setNotice(null)
  }

  const handleToggleHour = (hour: number) => {
    if (isSelectedDateInPast) {
      return
    }

    if (takenHours.has(hour)) {
      return
    }

    setSelectedHours((previous) => {
      if (previous.includes(hour)) {
        return previous.filter((item) => item !== hour)
      }

      return [...previous, hour].sort((a, b) => a - b)
    })
  }

  const handleBookHours = async () => {
    if (!user) {
      setNotice({ kind: "error", text: "Please login first." })
      return
    }

    if (isSelectedDateInPast) {
      setNotice({ kind: "error", text: "You cannot book past days." })
      return
    }

    if (selectedHours.length === 0) {
      setNotice({ kind: "error", text: "Select at least one hour." })
      return
    }

    setSubmittingBooking(true)

    const payload = selectedHours.map((hour) => ({
      booking_date: selectedDateKey,
      hour,
      booked_by: user.id,
    }))

    const { error } = await supabase.from("bookings").insert(payload)

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setNotice({ kind: "success", text: "Meeting room booked successfully." })
      setSelectedHours([])
      await loadMonthBookings(currentMonth)
    }

    setSubmittingBooking(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setAuthStep("email")
    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setNotice(null)
  }

  const handleDeleteBooking = async (booking: BookingRow) => {
    if (!user) {
      return
    }

    if (booking.booked_by !== user.id && !isHrUser) {
      setNotice({ kind: "error", text: "You can only delete your own bookings." })
      return
    }

    setDeletingBookingId(booking.id)

    const { error } = await supabase.from("bookings").delete().eq("id", booking.id)

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setNotice({ kind: "success", text: `Deleted ${toHourLabel(booking.hour)} booking.` })
      await loadMonthBookings(currentMonth)
    }

    setDeletingBookingId(null)
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-10 md:px-8">
        <div className="mx-auto max-w-7xl">
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">Loading...</CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (!hasSupabaseEnv) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-10 md:px-8">
        <div className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>DigiZag Meeting Room</CardTitle>
              <CardDescription>Supabase environment variables are missing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Add these variables in `.env.local`:</p>
              <p>`NEXT_PUBLIC_SUPABASE_URL`</p>
              <p>`NEXT_PUBLIC_SUPABASE_ANON_KEY`</p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-10 md:px-8">
        <div className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>DigiZag Meeting Room</CardTitle>
              <CardDescription>Email + password login.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {authStep === "email" && (
                <form className="space-y-3" onSubmit={handleEmailStepSubmit}>
                  <Input
                    type="email"
                    placeholder="name@digizag.com"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                  />
                  <Button type="submit" disabled={checkingEmail}>
                    <MailIcon className="size-4" />
                    {checkingEmail ? "Checking..." : "Continue"}
                  </Button>
                </form>
              )}

              {(authStep === "login" || authStep === "signup") && (
                <form className="space-y-3" onSubmit={handleAuthSubmit}>
                  <Input type="email" value={normalizedEmail} disabled />
                  <div className="relative">
                    <Input
                      type={showAuthPassword ? "text" : "password"}
                      placeholder={authStep === "login" ? "Enter your password" : "Create password"}
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      className="pr-24"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowAuthPassword((prev) => !prev)}
                    >
                      {showAuthPassword ? (
                        <span className="inline-flex items-center gap-1">
                          <EyeOffIcon className="size-3.5" />
                          Hide
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <EyeIcon className="size-3.5" />
                          View
                        </span>
                      )}
                    </button>
                  </div>
                  {authStep === "signup" && (
                    <div className="relative">
                      <Input
                        type={showAuthPasswordConfirm ? "text" : "password"}
                        placeholder="Confirm password"
                        value={authPasswordConfirm}
                        onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                        className="pr-24"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAuthPasswordConfirm((prev) => !prev)}
                      >
                        {showAuthPasswordConfirm ? (
                          <span className="inline-flex items-center gap-1">
                            <EyeOffIcon className="size-3.5" />
                            Hide
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <EyeIcon className="size-3.5" />
                            View
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={submittingAuth}>
                      {authStep === "login" ? <LockIcon className="size-4" /> : <UserPlusIcon className="size-4" />}
                      {submittingAuth
                        ? authStep === "login"
                          ? "Logging in..."
                          : "Creating..."
                        : authStep === "login"
                          ? "Login"
                          : "Create Account"}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleBackToEmail}>
                      <ArrowLeftIcon className="size-4" />
                      Change Email
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {notice && (
            <div className="mt-4">
              <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
                <AlertTitle>{notice.kind === "error" ? "Error" : "Done"}</AlertTitle>
                <AlertDescription>{notice.text}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        {notice && (
          <div className="mb-4">
            <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
              <AlertTitle>{notice.kind === "error" ? "Error" : "Done"}</AlertTitle>
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <Card>
            <CardHeader>
              <div className="mb-2">
                <Image
                  src="/digizag%20logo.png"
                  alt="DigiZag Logo"
                  width={280}
                  height={96}
                  className="h-14 w-auto object-contain md:h-16"
                  priority
                />
              </div>
              <CardTitle className="text-2xl">DigiZag Meeting Room</CardTitle>
              <CardDescription>{currentUserName} - DigiZag</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock3Icon className="size-4" />
                Hourly slots
              </div>
              <div className="flex items-center gap-2">
                <CalendarIcon className="size-4" />
                Multi-hour booking enabled
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{TIME_ZONE}</Badge>
              </div>
              <Button variant="destructive" onClick={handleSignOut}>
                <LogOutIcon className="size-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeftIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRightIcon className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-2">
                {calendarDays.map((day) => {
                  const key = formatDateKey(day)
                  const isInCurrentMonth = isSameMonth(day, currentMonth)
                  const isSelected = isSameDay(day, selectedDate)
                  const summary = bookingsByDate.get(key)

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedDate(day)
                        setSelectedHours([])
                      }}
                      className={[
                        "min-h-20 rounded-lg border p-2 text-left transition",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted",
                        !isInCurrentMonth && "opacity-45",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="text-sm font-semibold">{format(day, "d")}</div>

                      {summary && (
                        <div className="mt-1 space-y-1">
                          <div className="text-[10px] opacity-80">{summary.count} booked hour(s)</div>
                          <div className="space-y-0.5">
                            {summary.names.slice(0, 2).map((name) => (
                              <div key={`${key}-${name}`} className="truncate text-[10px] opacity-85">
                                {name}
                              </div>
                            ))}
                            {summary.names.length > 2 && (
                              <div className="text-[10px] opacity-80">+{summary.names.length - 2} more</div>
                            )}
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{format(selectedDate, "EEE d")}</CardTitle>
              <CardDescription>
                Select one or more hours to book, or delete your own booking.
              </CardDescription>
              {isSelectedDateInPast && (
                <p className="text-xs text-destructive">Past days cannot be booked.</p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {HOURS.map((hour) => {
                const booking = selectedDateBookings.find((item) => item.hour === hour)
                const isBooked = Boolean(booking)
                const checked = selectedHours.includes(hour)
                const isOwnBooking = booking?.booked_by === user.id
                const canDeleteBooking = Boolean(booking && (isOwnBooking || isHrUser))
                const isDeleting = deletingBookingId === booking?.id

                return (
                  <div
                    key={hour}
                    className={[
                      "flex items-center justify-between rounded-lg border px-3 py-2",
                      isBooked ? "border-border bg-muted/60" : "border-border bg-background",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="font-medium">{toHourLabel(hour)}</span>

                    {isBooked ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {getDisplayName(resolveProfile(booking?.profiles ?? null))}
                        </Badge>
                        {canDeleteBooking && booking && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteBooking(booking)}
                            disabled={isDeleting}
                          >
                            <Trash2Icon className="size-3.5" />
                            {isDeleting ? "Deleting..." : "Delete"}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {isSelectedDateInPast ? "Past day" : "Available"}
                        </span>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => handleToggleHour(hour)}
                          disabled={isSelectedDateInPast}
                          aria-label={`Select ${toHourLabel(hour)}`}
                        />
                      </span>
                    )}
                  </div>
                )
              })}

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Selected hours</span>
                <span>{selectedHours.length}</span>
              </div>

              <Button
                onClick={handleBookHours}
                disabled={submittingBooking || selectedHours.length === 0 || isSelectedDateInPast}
              >
                {submittingBooking ? "Booking..." : `Book ${selectedHours.length} Hour(s)`}
              </Button>

              {loadingBookings && <p className="text-xs text-muted-foreground">Refreshing bookings...</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
