import { useState, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  Droplets, ShieldCheck, CheckCircle2, Loader2, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useCreatePublicInstantWaterAssessment,
  useGetPublicInstantWaterAssessmentResult,
  useRequestInstantWaterAssessmentVerification,
  useConfirmInstantWaterAssessmentVerification,
  useRequestInstantWaterPhysicalTest,
  type InstantWaterAssessmentCreated,
  type PublicInstantWaterAssessmentResult,
} from "@workspace/api-client-react";

// --- Schema ---

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  phone: z.string().min(7, "Please enter a valid WhatsApp number").max(40),
  country: z.string().min(2, "Country is required").max(80),
  area: z.string().min(1, "Area/Town is required").max(160),
  source: z.enum(["municipal", "borehole", "shallow", "vendor", "bottled", "rain"], {
    required_error: "Please select your water source",
  }),
  concern: z.enum(["scale", "taste", "cloudy", "skin", "safety", "cost"], {
    required_error: "Please select your main concern",
  }),
  setting: z.enum(["home", "rental", "salon", "office", "hospitality", "school", "resell"], {
    required_error: "Please select the setting",
  }),
  consent: z.boolean().refine(val => val === true, {
    message: "You must agree to receive your result on WhatsApp",
  }),
});

type FormValues = z.infer<typeof formSchema>;

// --- Helper Data ---

const COUNTRIES = [
  { name: "Kenya", live: true },
  { name: "Tanzania", live: false },
  { name: "Rwanda", live: false },
  { name: "Ghana", live: false },
  { name: "Other", live: false },
];

const KENYA_AREAS = [
  "Nairobi - Westlands", "Nairobi - Kilimani", "Nairobi - Karen", "Nairobi - Eastlands",
  "Kiambu", "Ruiru", "Thika", "Athi River / Mavoko", "Kitengela", "Ngong", "Rongai",
  "Machakos", "Nakuru", "Naivasha", "Eldoret", "Kisumu", "Mombasa", "Nyeri", "Meru"
];

// --- Component ---

export default function WaterCheckPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const token = searchParams.get("token");
  const urlAssessmentId = searchParams.get("assessmentId");

  const [createdData, setCreatedData] = useState<InstantWaterAssessmentCreated | null>(null);

  const { toast } = useToast();

  const createMutation = useCreatePublicInstantWaterAssessment();

  // If token is provided, fetch result
  const { data: fetchedResult, isLoading: isFetchingResult, error: fetchError } =
    useGetPublicInstantWaterAssessmentResult(token || "", {
      query: { enabled: !!token, queryKey: ["public-water-result", token || ""] }
    });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      phone: "",
      country: "",
      area: "",
      consent: false,
    },
  });

  const selectedCountry = form.watch("country");
  const isMarketLive = COUNTRIES.find(c => c.name === selectedCountry)?.live ?? false;

  const submitKeyRef = useRef(crypto.randomUUID());

  const onSubmit = (values: FormValues) => {
    // Collect UTM/SRC attribution
    const src = searchParams.get("src") || searchParams.get("utm_campaign") || undefined;
    const utmSource = searchParams.get("utm_source") || undefined;
    const utmMedium = searchParams.get("utm_medium") || undefined;
    const utmCampaign = searchParams.get("utm_campaign") || undefined;
    const utmContent = searchParams.get("utm_content") || undefined;

    createMutation.mutate({
      data: {
        idempotencyKey: submitKeyRef.current,
        firstName: values.firstName,
        phone: values.phone,
        consent: true,
        sourceAttribution: { src, utmSource, utmMedium, utmCampaign, utmContent },
        answers: {
          country: values.country,
          area: values.area,
          source: values.source,
          concern: values.concern,
          setting: values.setting,
        }
      }
    }, {
      onSuccess: (data) => {
        setCreatedData(data);
        submitKeyRef.current = crypto.randomUUID();
        navigate(`/water-check?token=${data.resultToken}&assessmentId=${data.assessmentId}`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
      onError: () => {
        toast({
          title: "Something went wrong",
          description: "We couldn't save your assessment. Please try again.",
          variant: "destructive"
        });
      }
    });
  };

  const resultToDisplay = fetchedResult || createdData?.result;
  const activeAssessmentId = createdData?.assessmentId || urlAssessmentId;

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 font-sans selection:bg-cyan-500/30">
      <div className="max-w-xl mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <Droplets className="w-10 h-10 text-cyan-400 mx-auto mb-4" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-2">
            Free Water Check
          </h1>
          <p className="text-slate-400 text-sm md:text-base">
            Answer six questions and get an indicative read on your water in under a minute — hardness, taste, sediment and more. Free, no lab required.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-6 text-xs text-slate-500 font-medium tracking-wide">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> SGS tested</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> TÜV SÜD certified</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> No spam calls</span>
          </div>
        </div>

        {/* Loading Token State */}
        {isFetchingResult && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-4" />
            <p>Loading your water profile...</p>
          </div>
        )}

        {/* Error Token State */}
        {fetchError && !isFetchingResult && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
              <p className="text-slate-300 mb-4">We couldn't load your result. The link might be expired or invalid.</p>
              <Button onClick={() => window.location.href = "/water-check"} variant="outline" className="text-cyan-400 border-cyan-400/30 hover:bg-cyan-950">
                Start a new check
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Form State */}
        {!resultToDisplay && !isFetchingResult && !fetchError && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 md:p-8 backdrop-blur-sm">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">First name <span className="text-red-400">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Amara" className="bg-slate-950 border-slate-800 focus-visible:ring-cyan-500/50" {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">WhatsApp <span className="text-red-400">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="0722 123 456" type="tel" className="bg-slate-950 border-slate-800 focus-visible:ring-cyan-500/50" {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Country <span className="text-red-400">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-slate-950 border-slate-800 focus:ring-cyan-500/50">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                            {COUNTRIES.map(c => (
                              <SelectItem key={c.name} value={c.name}>
                                {c.name} {c.live ? "" : "— testing coming soon"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="area"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Town / area <span className="text-red-400">*</span></FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Nairobi – Westlands"
                            list="areas-list"
                            className="bg-slate-950 border-slate-800 focus-visible:ring-cyan-500/50"
                            {...field}
                          />
                        </FormControl>
                        <datalist id="areas-list">
                          {selectedCountry === "Kenya" && KENYA_AREAS.map(a => <option key={a} value={a} />)}
                        </datalist>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                </div>

                {selectedCountry && !isMarketLive && (
                  <div className="bg-amber-950/30 border border-amber-500/30 text-amber-200/90 text-sm p-4 rounded-lg">
                    <strong>{selectedCountry}:</strong> You will still get your reading now, and we will send product options on WhatsApp. On-site testing is not running there yet — we will tell you the moment it is.
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">Where does your water come from? <span className="text-red-400">*</span></FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-950 border-slate-800 focus:ring-cyan-500/50">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                          <SelectItem value="municipal">Piped / municipal tap</SelectItem>
                          <SelectItem value="borehole">Borehole or deep well</SelectItem>
                          <SelectItem value="shallow">Shallow well, river or spring</SelectItem>
                          <SelectItem value="vendor">Water vendor, bowser or tanker</SelectItem>
                          <SelectItem value="bottled">Bottled or sachet water</SelectItem>
                          <SelectItem value="rain">Rainwater harvesting</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="concern"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">What bothers you most? <span className="text-red-400">*</span></FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-950 border-slate-800 focus:ring-cyan-500/50">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                          <SelectItem value="scale">White scale in the kettle, appliances dying early</SelectItem>
                          <SelectItem value="taste">Taste or smell — chlorine, metallic, earthy</SelectItem>
                          <SelectItem value="cloudy">Cloudy water, sediment or staining</SelectItem>
                          <SelectItem value="skin">Dry skin, itchy scalp, hair feels rough after showering</SelectItem>
                          <SelectItem value="safety">Not sure it is safe to drink</SelectItem>
                          <SelectItem value="cost">Cost of buying bottled water every week</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="setting"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">This is for <span className="text-red-400">*</span></FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-950 border-slate-800 focus:ring-cyan-500/50">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                          <SelectItem value="home">My home</SelectItem>
                          <SelectItem value="rental">A rented place</SelectItem>
                          <SelectItem value="salon">A salon, spa or barber</SelectItem>
                          <SelectItem value="office">An office or co-working space</SelectItem>
                          <SelectItem value="hospitality">A hotel, lodge, restaurant or gym</SelectItem>
                          <SelectItem value="school">A school, clinic or NGO</SelectItem>
                          <SelectItem value="resell">I want to resell or distribute</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="consent"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border border-slate-800 rounded-lg bg-slate-950/50">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-slate-600 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-tight">
                        <FormLabel className="text-sm font-medium text-slate-300 cursor-pointer">
                          Send my result and let an Ultra Clear specialist follow up on WhatsApp.
                        </FormLabel>
                        <FormDescription className="text-xs text-slate-500">
                          I can opt out any time. We never sell your number.
                        </FormDescription>
                        <FormMessage className="text-red-400" />
                      </div>
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
                  ) : (
                    "Show my water reading"
                  )}
                </Button>
              </form>
            </Form>
          </div>
        )}

        {/* Result State */}
        {resultToDisplay && (
          <ResultView
            result={resultToDisplay}
            assessmentId={activeAssessmentId}
          />
        )}
      </div>
    </div>
  );
}

// --- Result View Subcomponent ---

function ResultView({ result, assessmentId }: { result: PublicInstantWaterAssessmentResult, assessmentId?: string | null }) {
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [accountLinkState, setAccountLinkState] = useState<string | null>(null);
  const [handoffToken, setHandoffToken] = useState<string | null>(null);
  const [serviceState, setServiceState] = useState<string | null>(result.physicalTestStatus || null);

  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [physicalTestDialogOpen, setPhysicalTestDialogOpen] = useState(false);
  const [activeIntent, setActiveIntent] = useState<"verify" | "physical_test" | null>(null);

  const handleIntent = (intent: "verify" | "physical_test") => {
    setActiveIntent(intent);
    if (!actionToken) {
      setVerifyDialogOpen(true);
    } else if (intent === "physical_test") {
      setPhysicalTestDialogOpen(true);
    }
  };

  const handleVerifySuccess = (token: string, linkState?: string, handoff?: string) => {
    setActionToken(token);
    if (linkState) setAccountLinkState(linkState);
    if (handoff) setHandoffToken(handoff);
    setVerifyDialogOpen(false);

    if (activeIntent === "physical_test") {
      setPhysicalTestDialogOpen(true);
    }
  };

  const bands = [
    { key: "hardness", label: "Hardness & scale", value: result.bands.hardness },
    { key: "taste", label: "Taste & odour", value: result.bands.taste },
    { key: "sediment", label: "Sediment & clarity", value: result.bands.sediment },
    { key: "microbial", label: "Microbial risk", value: result.bands.microbial },
  ];

  const getColor = (val: string) => {
    if (val === "Low") return "bg-emerald-500 text-emerald-500";
    if (val === "Moderate") return "bg-amber-500 text-amber-500";
    if (val === "High") return "bg-rose-500 text-rose-500";
    return "bg-slate-500 text-slate-500";
  };

  const getPercentage = (val: string) => {
    if (val === "Low") return "33%";
    if (val === "Moderate") return "66%";
    if (val === "High") return "100%";
    return "0%";
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <div className="text-center mb-8">
        <p className="text-cyan-400 font-bold uppercase tracking-widest text-xs mb-2">Your indicative reading</p>
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">Water Profile</h2>
        <p className="text-slate-400 text-sm">{result.summary}</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 md:p-6 backdrop-blur-sm space-y-5">
        {bands.map((b) => (
          <div key={b.key} className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="font-semibold text-slate-200">{b.label}</span>
              <span className={`text-xs font-bold uppercase tracking-wider ${getColor(b.value).split(" ")[1]}`}>
                {b.value}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${getColor(b.value).split(" ")[0]}`}
                style={{ width: getPercentage(b.value) }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-xl p-5 md:p-6">
        <p className="text-cyan-400 font-bold uppercase tracking-widest text-xs mb-2">Best Match</p>
        <h3 className="text-xl font-bold text-white mb-2">{result.recommendation.name}</h3>
        <p className="text-slate-300 text-sm leading-relaxed">{result.recommendation.explanation}</p>
      </div>

      {result.areaFlag === "rift_valley_fluoride" && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-5 text-sm text-amber-200/90">
          <strong className="text-amber-400 block mb-1">One thing a strip cannot tell you.</strong>
          Groundwater across the Rift Valley commonly carries elevated fluoride. That needs a laboratory test, not a field kit, and no filter should be sold to you on the strength of a guess. We will flag it for the technician so it is measured properly before anything is recommended.
        </div>
      )}

      {result.areaFlag === "hard_groundwater" && (
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-5 text-sm text-slate-300">
          <strong className="text-slate-100 block mb-1">Hard Groundwater Area.</strong>
          Your area is known for hard groundwater, which is reflected in your profile. Hard water builds up scale in kettles and appliances quickly.
        </div>
      )}

      <div className="pt-4 border-t border-slate-800 space-y-3">
        {result.serviceAvailable ? (
          <>
            <h3 className="font-bold text-white mb-2 text-lg">Book the free on-site check</h3>
            <p className="text-sm text-slate-400 mb-6">
              A technician tests your actual water — hardness, TDS and clarity — and leaves you the numbers whether or not you buy anything.
            </p>
          </>
        ) : (
          <>
            <h3 className="font-bold text-white mb-2 text-lg">Get your options on WhatsApp</h3>
            <p className="text-sm text-slate-400 mb-6">
              On-site testing has not reached your area yet. A specialist will send the right options for this profile, with pricing, and tell you when testing arrives.
            </p>
          </>
        )}

        {result.serviceAvailable && (serviceState === null || serviceState === "instant_result_ready") && (
          <Button
            className="w-full h-12 text-base font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950"
            onClick={() => handleIntent("physical_test")}
          >
            Book a physical water test
          </Button>
        )}

        {serviceState !== null && serviceState !== "instant_result_ready" && (
          <div className="w-full h-12 text-base font-bold bg-slate-800 text-cyan-400 rounded-md flex items-center justify-center border border-slate-700 capitalize">
            {serviceState.replace(/_/g, ' ')}
          </div>
        )}

        <Button
          variant="outline"
          className="w-full h-12 text-base font-bold text-cyan-400 border-cyan-400/30 hover:bg-cyan-950"
          onClick={() => window.open(`https://wa.me/254717774049?text=${encodeURIComponent("Hello Ultra Clear, I would like to follow up on my water test result. Reference: " + result.reference)}`, "_blank")}
        >
          Send result on WhatsApp
        </Button>

        {accountLinkState === "attached" && (
          <Button
            variant="outline"
            className="w-full h-12 text-base font-bold text-slate-300 border-slate-700 hover:bg-slate-800"
            onClick={() => window.location.href = "/uc-companion/"}
          >
            View in my account
          </Button>
        )}

        {accountLinkState === "verified_unmatched" && (
          <div className="space-y-3 pt-2">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-sm text-slate-300">
              <strong className="text-white block mb-1">Number verified</strong>
              {handoffToken 
                ? "Your number is verified, but we couldn't find an existing account. You can continue booking your test above, or create an account to save this reading."
                : "Your number is verified, but we couldn't find an existing account. You can continue booking your test above."}
            </div>
            {handoffToken && (
              <Button
                variant="outline"
                className="w-full h-12 text-base font-bold text-slate-300 border-slate-700 hover:bg-slate-800"
                onClick={() => window.location.href = `/uc-companion/water-test#water-check-handoff=${handoffToken}`}
              >
                Create Companion Account
              </Button>
            )}
          </div>
        )}

        {accountLinkState !== "attached" && accountLinkState !== "verified_unmatched" && (
          <Button
            variant="outline"
            className="w-full h-12 text-base font-bold text-slate-300 border-slate-700 hover:bg-slate-800"
            onClick={() => handleIntent("verify")}
          >
            Verify and save to my account
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500 text-center pt-6 leading-relaxed">
        This is an indicative profile built from your answers and known conditions in your area.
        It is not a laboratory analysis and is not a health assessment. Where a lab test is the
        right next step, we say so above rather than guessing.
      </p>

      {assessmentId && (
        <>
          <VerifyDialog
            assessmentId={assessmentId}
            open={verifyDialogOpen}
            onClose={() => setVerifyDialogOpen(false)}
            onSuccess={handleVerifySuccess}
          />
          {actionToken && (
            <PhysicalTestDialog
              assessmentId={assessmentId}
              actionToken={actionToken}
              open={physicalTestDialogOpen}
              onClose={() => setPhysicalTestDialogOpen(false)}
              onSuccess={(state) => setServiceState(state)}
            />
          )}
        </>
      )}
    </div>
  );
}

function VerifyDialog({
  assessmentId, open, onClose, onSuccess
}: {
  assessmentId: string; open: boolean; onClose: () => void; onSuccess: (token: string, state?: string, handoffToken?: string) => void;
}) {
  const [step, setStep] = useState<"channel" | "code">("channel");
  const [code, setCode] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const { toast } = useToast();

  const requestKeyRef = useRef(crypto.randomUUID());

  const requestMutation = useRequestInstantWaterAssessmentVerification();
  const confirmMutation = useConfirmInstantWaterAssessmentVerification();

  const handleRequest = (channel: "whatsapp" | "sms") => {
    requestMutation.mutate({
      assessmentId,
      data: { idempotencyKey: requestKeyRef.current, channel, smsConsent: channel === "sms" ? true : undefined }
    }, {
      onSuccess: () => {
        setStep("code");
      },
      onError: () => {
        toast({ title: "Failed to send code", description: "Please try again.", variant: "destructive" });
      }
    });
  };

  const handleConfirm = () => {
    confirmMutation.mutate({
      assessmentId,
      data: { code }
    }, {
      onSuccess: (data) => {
        if (data.verified) {
          toast({ title: data.accountLinkState === "attached" ? "Saved to your account!" : "Verified successfully!" });
          onSuccess(data.actionToken, data.accountLinkState, data.handoffToken);
        } else {
          toast({ title: "Invalid code", variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Verification failed", description: "Invalid or expired code.", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify your number</DialogTitle>
          <DialogDescription className="text-slate-400">
            {step === "channel" ? "Choose how you'd like to receive your verification code." : "Enter the 6-digit code sent to your phone."}
          </DialogDescription>
        </DialogHeader>

        {step === "channel" ? (
          <div className="flex flex-col gap-5 py-4">
            <Button
              variant="outline"
              className="w-full justify-start h-12 bg-slate-950 border-slate-700 hover:bg-slate-800 text-slate-200"
              onClick={() => handleRequest("whatsapp")}
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Send code via WhatsApp
            </Button>

            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="smsConsent"
                  checked={smsConsent} onCheckedChange={(c) => setSmsConsent(!!c)}
                  className="border-slate-600 mt-1 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                />
                <Label htmlFor="smsConsent" className="text-xs text-slate-400 leading-tight">
                  I consent to receive a one-time SMS verification code. Standard rates may apply.
                </Label>
              </div>
              <Button
                variant="outline"
                className="w-full justify-start h-12 bg-slate-950 border-slate-700 hover:bg-slate-800 text-slate-200"
                onClick={() => handleRequest("sms")}
                disabled={!smsConsent || requestMutation.isPending}
              >
                {requestMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Send code via SMS
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            <Label htmlFor="code" className="text-slate-300">6-digit Code</Label>
            <Input
              id="code"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="bg-slate-950 border-slate-700 focus-visible:ring-cyan-500/50 text-lg tracking-widest text-center h-12"
              placeholder="123456"
              maxLength={6}
            />
            <Button
              onClick={handleConfirm}
              disabled={code.length !== 6 || confirmMutation.isPending}
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 h-12 font-bold mt-2"
            >
              {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Confirm Code
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhysicalTestDialog({
  assessmentId, actionToken, open, onClose, onSuccess
}: {
  assessmentId: string; actionToken: string; open: boolean; onClose: () => void; onSuccess: (state: string) => void;
}) {
  const [address, setAddress] = useState("");
  const [time, setTime] = useState("");
  const [ack, setAck] = useState(false);
  const { toast } = useToast();

  const testKeyRef = useRef(crypto.randomUUID());

  const testMutation = useRequestInstantWaterPhysicalTest();

  const handleSubmit = () => {
    testMutation.mutate({
      assessmentId,
      data: {
        idempotencyKey: testKeyRef.current,
        actionToken,
        serviceAddress: address,
        preferredContactTime: time,
        acknowledgement: true,
      }
    }, {
      onSuccess: (data) => {
        testKeyRef.current = crypto.randomUUID();
        toast({ title: "Request submitted successfully" });
        onSuccess(data.serviceState);
        onClose();
      },
      onError: () => {
        toast({ title: "Failed to submit request", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book Physical Test</DialogTitle>
          <DialogDescription className="text-slate-400">
            A technician will visit to test your water.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="address">Service Address</Label>
            <Input
              id="address"
              value={address} onChange={e => setAddress(e.target.value)}
              placeholder="123 Main St, Nairobi"
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="time">Preferred Contact Time</Label>
            <Input
              id="time"
              value={time} onChange={e => setTime(e.target.value)}
              placeholder="e.g. Tomorrow morning, After 2pm"
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <div className="flex items-start space-x-2 pt-2">
            <Checkbox
              id="ack"
              checked={ack} onCheckedChange={(checked) => setAck(!!checked)}
              className="border-slate-600 mt-1 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
            />
            <Label htmlFor="ack" className="text-xs text-slate-400 leading-tight">
              I acknowledge that my contact and service address data will be processed for scheduling and delivery.
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!address || !time || !ack || testMutation.isPending}
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 w-full font-bold"
          >
            {testMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
